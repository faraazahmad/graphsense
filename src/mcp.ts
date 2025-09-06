import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateObject } from "ai";

import { executeQuery, db, setupDB } from "./db";
import { PINECONE_API_KEY, claude } from "./env";
import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

interface FunctionResult {
  id: string;
  summary: string;
  path: string;
  name: string;
  start_line: number;
  end_line: number;
  similarity_score: number;
}

export async function batchValidateFunctions(
  description: string,
  functions: FunctionResult[],
  batchSize: number = 20,
): Promise<FunctionResult[]> {
  const validatedFunctions: FunctionResult[] = [];

  for (let i = 0; i < functions.length; i += batchSize) {
    const batch = functions.slice(i, i + batchSize);

    const validationPrompt = `You are evaluating whether functions match a given description.

Description: "${description}"

Functions to evaluate:
${batch
  .map(
    (func, idx) =>
      `${idx + 1}. Function: ${func.name}
     Path: ${func.path}
     Summary: ${func.summary}`,
  )
  .join("\n\n")}

For each function, determine if it matches the description. Return true if it matches, false otherwise.`;

    try {
      const result = await generateObject({
        model: claude,
        prompt: validationPrompt,
        schema: z.object({
          evaluations: z.array(
            z.object({
              functionIndex: z.number(),
              matches: z.boolean(),
            }),
          ),
        }),
      });
      console.log(result.usage.totalTokens);

      // Add matching functions to result in original order and stop on first false
      let shouldStop = false;
      const matchingIndices = new Set<number>();
      
      // First pass: collect matching indices and check for early stop
      for (const evaluation of result.object.evaluations) {
        if (
          evaluation.functionIndex >= 0 &&
          evaluation.functionIndex < batch.length
        ) {
          if (evaluation.matches) {
            matchingIndices.add(evaluation.functionIndex);
          } else {
            // Since results are sorted by similarity, if this doesn't match,
            // subsequent functions are unlikely to match either
            shouldStop = true;
            break;
          }
        }
      }
      
      // Second pass: add functions in original order
      for (let i = 0; i < batch.length; i++) {
        if (matchingIndices.has(i)) {
          validatedFunctions.push(batch[i]);
        }
      }

      if (shouldStop) {
        break;
      }
    } catch (error) {
      console.error("Error validating batch:", error);
      // Fallback: include all functions in batch if LLM validation fails
      validatedFunctions.push(...batch);
    }
  }

  return validatedFunctions;
}

export async function getSimilarFunctions(description: string) {
  console.log(description);

  // Generate embedding for the search query using Pinecone
  const embeddingResponse = await pinecone.inference.embed(
    "multilingual-e5-large",
    [description],
    { inputType: "query" },
  );

  // Handle both dense and sparse embeddings
  let queryEmbedding: number[] = [];
  if (embeddingResponse.data && embeddingResponse.data.length > 0) {
    const embeddingData = embeddingResponse.data[0];
    if ("values" in embeddingData) {
      queryEmbedding = embeddingData.values;
    }
  }

  // Use pgvector cosine similarity to find similar functions (no limit)
  const similarityResults = await db.relational.client!.query(
    `
    SELECT
      id,
      summary,
      path,
      name,
      start_line,
      end_line,
      1 - (embedding <=> $1::vector) as similarity_score
    FROM functions
    WHERE embedding IS NOT NULL
      AND summary IS NOT NULL
    ORDER BY embedding <=> $1::vector
  `,
    [JSON.stringify(queryEmbedding)],
  );

  // Extract results
  const allResults: FunctionResult[] = similarityResults.rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    path: row.path,
    name: row.name,
    start_line: row.start_line,
    end_line: row.end_line,
    similarity_score: row.similarity_score,
  }));

  // Validate results using LLM in batches
  const validatedResults = await batchValidateFunctions(
    description,
    allResults,
  );

  return validatedResults;
}

// Create and configure MCP server
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "GraphSense MCP Server",
    version: "1.0.0",
  });

  // Add similar functions search tool
  server.tool(
    "similar_functions",
    "To search for functions in the codebase based on what they do. Uses LLM validation to ensure semantic matches.",
    {
      function_description: z
        .string()
        .describe("description of the task performed by the function"),
    },
    async ({ function_description }: { function_description: string }) => {
      try {
        const functions = await getSimilarFunctions(function_description);

        if (functions.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No similar functions found for the given description.",
              },
            ],
          };
        }

        const formattedResponse = functions
          .map(
            (func, index) =>
              `${index + 1}. **${func.name}**\n` +
              `   - **Path:** ${func.path}:${func.start_line}-${func.end_line}\n` +
              `   - **Summary:** ${func.summary}`,
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${functions.length} similar functions:\n\n${formattedResponse}`,
            },
          ],
        };
      } catch (error) {
        console.error(error);
        return {
          content: [
            {
              type: "text",
              text: `Error finding similar functions: ${error}`,
            },
          ],
        };
      }
    },
  );

  // Add function callers tool
  server.tool(
    "function_callers",
    "Find functions that call a specific function",
    {
      functionName: z
        .string()
        .describe("The name of the function to find callers for"),
      functionPath: z
        .string()
        .describe("The path of the function to find callers for"),
    },
    async ({
      functionName,
      functionPath,
    }: {
      functionName: string;
      functionPath: string;
    }) => {
      try {
        const result = await executeQuery(
          `
          MATCH (caller:Function)-[:CALLS]->(target:Function)
          WHERE target.name = $functionName AND target.path = $functionPath
          RETURN caller.name as name, caller.path as path, caller.summary as summary
          `,
          { functionName, functionPath },
        );

        if (result.records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No functions found that call this function.",
              },
            ],
          };
        }

        const formattedResponse = result.records
          .map(
            (record, index) =>
              `${index + 1}. **${record.get("name") || "Unknown"}**\n` +
              `   - **Path:** ${record.get("path") || "Unknown"}\n` +
              `   - **Summary:** ${record.get("summary") || "No summary available"}`,
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${result.records.length} functions that call this function:\n\n${formattedResponse}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error finding function callers: ${error}`,
            },
          ],
        };
      }
    },
  );

  // Add function callees tool
  server.tool(
    "function_callees",
    "Find functions called by a specific function",
    {
      functionName: z
        .string()
        .describe("The name of the function to find callees for"),
      functionPath: z
        .string()
        .describe("The path of the function to find callees for"),
    },
    async ({
      functionName,
      functionPath,
    }: {
      functionName: string;
      functionPath: string;
    }) => {
      try {
        const result = await executeQuery(
          `
          MATCH (source:Function)-[:CALLS]->(callee:Function)
          WHERE source.name = $functionName AND source.path = $functionPath
          RETURN callee.name as name, callee.path as path, callee.summary as summary
          `,
          { functionName, functionPath },
        );

        if (result.records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "This function doesn't call any other functions.",
              },
            ],
          };
        }

        const formattedResponse = result.records
          .map(
            (record, index) =>
              `${index + 1}. **${record.get("name") || "Unknown"}**\n` +
              `   - **Path:** ${record.get("path") || "Unknown"}\n` +
              `   - **Summary:** ${record.get("summary") || "No summary available"}`,
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `This function calls ${result.records.length} functions:\n\n${formattedResponse}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error finding function callees: ${error}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

// Start the server
if (require.main === module) {
  setupDB()
    .then(() => {
      const server = createMcpServer();
      const transport = new StdioServerTransport();
      server.connect(transport);
      console.log("GraphSense MCP Server running on stdio");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { createMcpServer };
