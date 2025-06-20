import {
  isCallExpression,
  isIdentifier,
  forEachChild,
  FunctionDeclaration,
  Node,
} from "typescript";
import { generateText, GenerateTextResult } from "ai";
import { db, executeQuery, pc } from "./db";
import { cleanPath, getRepoPath } from ".";
import { claude, gemini, getRepoQualifier, REPO_URI } from "./env";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers";

export async function parseFunctionDeclaration(
  node: FunctionDeclaration,
  reParse = false,
) {
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

  const result = await executeQuery(
    `
      MERGE (function:Function {name: $name, path: $path}) return elementId(function) as id
    `,
    {
      path: cleanPath(node.getSourceFile().fileName),
      name: node.name?.escapedText,
    },
  );

  try {
    const functionId = result.records.map((rec) => rec.get("id"));
    const sourceFile = node.getSourceFile();

    await db.relational.client!.query(
      `
        INSERT INTO functions (id, name, path, start_line, end_line, parsed)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        path = EXCLUDED.path,
        start_line = EXCLUDED.start_line,
        end_line = EXCLUDED.end_line,
        parsed = EXCLUDED.parsed,
      `,
      [
        functionId,
        node.name?.escapedText,
        cleanPath(sourceFile.fileName),
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
        new Date(),
      ],
    );
    // const fxn = await db.relational.client!.query(
    //   `select id from functions where id = $1 limit 1`,
    //   [fileId[0]],
    // );
    // if (fxn.rows.length === 0) {
    //   console.log(
    //     `[${new Date().toUTCString()}]: Pushed function ${node.name?.escapedText} to processing queue`,
    //   );
    //   functionParseQueue.push({ node, functionNodeId: fileId[0], reParse });
    // }
  } catch (err: any) {
    console.error(err.message);
    return;
  }
  forEachChild(node, (child: Node) => extractFunctionCalls(node, child));

  if (!Array.from(callSet).length) {
    return;
  }
  addCallsRelation(
    node.name!.getText(),
    node.getSourceFile().fileName,
    callSet,
  );
}

export async function processFunctionWithAI(functionData: any) {
  const { id: functionNodeId, name, path, start_line, end_line } = functionData;

  console.log(`[${new Date().toUTCString()}]: Started parsing ${name}`);

  let functionText = "";
  try {
    const absolutePath = `${getRepoPath()}${path}`;
    const fileContent = readFileSync(absolutePath, "utf-8");

    const lines = fileContent.split("\n");
    functionText = lines.slice(start_line - 1, end_line).join("\n");
  } catch (error) {
    console.error(`Error reading function ${name} from ${path}:`, error);
    return;
  }

  let waitTime = 1000;
  let failed = false;
  let summary: string = "";
  do {
    try {
      if (failed) {
        waitTime *= 2.5;
        setTimeout(() => {}, waitTime);

        console.log(
          `[${new Date().toUTCString()}]: Retrying parsing ${name}() after waiting ${waitTime / 1000} seconds.`,
        );
      }

      const { text } = await generateText({
        model: claude,
        prompt: `Given the following function body, generate a 3 line summary for it: \`\`\`${functionText}\`\`\``,
      });
      summary = text.replace(new RegExp("<think>.*</think>"), "");
    } catch (error: any) {
      console.log(
        `[${new Date().toUTCString()}]: Error while parsing ${name}()`,
      );
      failed = true;
    }
  } while (failed);

  const namespace = getRepoQualifier(REPO_URI).replace("/", "-");
  await Promise.all([
    pc
      .index("graphsense-dense")
      .namespace(namespace)
      .upsertRecords([
        {
          id: functionNodeId,
          text: summary,
        },
      ]),
    pc
      .index("graphsense-sparse")
      .namespace(namespace)
      .upsertRecords([
        {
          id: functionNodeId,
          text: summary,
        },
      ]),
  ]);

  try {
    await db.relational.client!.query(
      `
        UPDATE functions
        SET summary = $2
        WHERE id = $1;
      `,
      [functionNodeId, summary],
    );

    console.log(`[${new Date().toUTCString()}]: Parsed function: ${name}`);
  } catch (err) {
    console.error(err);
  }
}

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
        match (caller:Function { name: $callerName, path: $callerPath }), (callee:Function { name: $calleeName, path: $calleePath })
        merge (caller)-[:CALLS]->(callee)
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
