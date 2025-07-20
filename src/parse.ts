import {
  isCallExpression,
  isIdentifier,
  forEachChild,
  FunctionDeclaration,
  Node,
} from "typescript";
import { generateText } from "ai";
import { db, executeQuery } from "./db";
import { cleanPath } from ".";
import { claude, PINECONE_API_KEY } from "./env";
import { Pinecone } from "@pinecone-database/pinecone";
import { setTimeout } from "node:timers";
import { createHash } from "node:crypto";

export async function parseFunctionDeclaration(node: FunctionDeclaration) {
  if (!node) {
    return;
  }

  const functionName = node.name?.escapedText?.toString() || "";
  if (!functionName) {
    return;
  }

  const fileName = cleanPath(node.getSourceFile().fileName);
  const functionText = node.getFullText();
  const callSet = new Set<string>();

  // Recursively visit each child to capture function calls from this node
  const extractFunctionCalls = (
    rootFunction: FunctionDeclaration,
    node: Node,
  ) => {
    if (isCallExpression(node) && isIdentifier(node.expression)) {
      const name = node.expression.escapedText.toString();
      callSet.add(name);
    }

    forEachChild(node, (child: Node) =>
      extractFunctionCalls(rootFunction, child),
    );
  };
  forEachChild(node, (child: Node) => extractFunctionCalls(node, child));
  if (!callSet.size) {
    return;
  }

  try {
    const fnWithChecksum = await db.relational.client!.query(
      `
        SELECT checksum, name, path FROM functions
        WHERE name = $1 AND path = $2
        LIMIT 1;
      `,
      [functionName, fileName],
    );

    const functionData = fnWithChecksum.rows[0];
    const checksum = createHash("sha1").update(functionText).digest("hex");
    if (functionData?.checksum === checksum) {
      return;
    }

    // Try multiple times with exponential backoff since these APIs can rate limit or experience downtime.
    let waitTime = 1000;
    let summary: string = "";
    let embedding: number[] = [];
    let summaryTries = 0;
    let embeddingTries = 0;

    // Generate function summary using LLM
    do {
      try {
        const { text } = await generateText({
          model: claude,
          prompt: `Given the following function body, generate a summary for it: \`\`\`${functionText}\`\`\``,
        });
        summary = text.replace(new RegExp("<think>.*</think>"), "");
        break;
      } catch (error: any) {
        console.log(
          `[${new Date().toUTCString()}]: Error while generating summary for ${functionName}():`,
          error.message,
        );
        summaryTries += 1;
        waitTime *= 2.5;
        setTimeout(() => {}, waitTime);
        console.log(
          `[${new Date().toUTCString()}]: Retrying summary generation for ${functionName}() after waiting ${waitTime / 1000}s.`,
        );
      }
    } while (summaryTries < 3);

    if (summaryTries >= 3) {
      console.log(
        `[${new Date().toUTCString()}]: Unable to generate summary for ${functionName}() after 3 tries.`,
      );
      return;
    }

    // Generate summary embeddings using Pinecone
    waitTime = 1000;
    do {
      try {
        const embeddingResponse = await pinecone.inference.embed(
          "multilingual-e5-large",
          [summary],
          { inputType: "passage" },
        );
        // Handle both dense and sparse embeddings
        if (embeddingResponse.data && embeddingResponse.data.length > 0) {
          const embeddingData = embeddingResponse.data[0];
          if ("values" in embeddingData) {
            embedding = embeddingData.values;
          } else {
            // Fallback for other embedding types
            embedding = [];
          }
        }
        break;
      } catch (error: any) {
        console.log(
          `[${new Date().toUTCString()}]: Error while generating embedding for ${functionName}():`,
          error.message,
        );
        embeddingTries += 1;
        waitTime *= 2.5;
        setTimeout(() => {}, waitTime);
        console.log(
          `[${new Date().toUTCString()}]: Retrying embedding generation for ${functionName}() after waiting ${waitTime / 1000}s.`,
        );
      }
    } while (embeddingTries < 3);

    if (embeddingTries >= 3) {
      console.log(
        `[${new Date().toUTCString()}]: Unable to generate embedding for ${functionName}() after 3 tries.`,
      );
      return;
    }

    console.log(`Updating ${functionName}() in DB.`);

    // Upsert function metadata into graph DB
    const result = await executeQuery(
      `
        MERGE (function:Function {name: $name, path: $path})
        return elementId(function) as id
      `,
      {
        path: fileName,
        name: functionName,
      },
    );
    addCallsRelation(functionName, fileName, callSet);
    const id: string = result.records.map((rec) => rec.get("id"))[0];

    const sourceFile = node.getSourceFile();
    const startLine =
      sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const endLine =
      sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

    // Upsert function metadata into relational DB
    await db.relational.client!.query(
      `
        INSERT INTO functions (id, name, path, start_line, end_line, parsed, checksum, summary, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        path = EXCLUDED.path,
        start_line = EXCLUDED.start_line,
        end_line = EXCLUDED.end_line,
        parsed = EXCLUDED.parsed,
        checksum = EXCLUDED.checksum,
        summary = EXCLUDED.summary,
        embedding = EXCLUDED.embedding
      `,
      [
        id,
        functionName,
        fileName,
        startLine,
        endLine,
        new Date(),
        checksum,
        summary,
        JSON.stringify(embedding),
      ],
    );
    console.log(`[${new Date().toUTCString()}]: Parsed ${functionName}()`);
  } catch (err: any) {
    console.log(
      `[${new Date().toUTCString()}]: Error parsing ${functionName}()`,
    );
    console.error(err);
    return;
  }
}

const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

async function addCallsRelation(
  caller: string,
  callerPath: string,
  callees: Set<string>,
) {
  // Check if caller sourceFile imports callee function, search for all functions at once
  // For all imported callees, Add :CALLS relation between the functions

  for (const callee of callees) {
    const result = await executeQuery(
      `
        match (importer:File { path: $path })-[importReln:IMPORTS_FROM]->(importee:File)
        where importReln.clause = $callee
        return importee.path as destination;
      `,
      { path: cleanPath(callerPath), callee: callee },
    );
    if (!result.records.length) {
      continue;
    }

    const destinationPath = result.records.map((rec) =>
      rec.get("destination"),
    )[0];
    executeQuery(
      `
        MERGE (caller:Function { name: $callerName, path: $callerPath })
        MERGE (callee:Function { name: $calleeName, path: $calleePath })
        MERGE (caller)-[:CALLS]->(callee)
      `,
      {
        callerName: caller,
        callerPath: cleanPath(callerPath),
        calleeName: callee,
        calleePath: cleanPath(destinationPath),
      },
    );
  }
}
