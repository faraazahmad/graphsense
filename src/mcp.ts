import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateObject } from "ai";

import { executeQuery, db, setupDB } from "./db";
import { PINECONE_API_KEY, claude } from "./env";
import { Pinecone } from "@pinecone-database/pinecone";
import { AnthropicProviderOptions } from "@ai-sdk/anthropic";

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
): Promise<{ functions: FunctionResult[]; totalTokens: number }> {
  const validatedFunctions: FunctionResult[] = [];
  let totalTokens = 0;

  for (let i = 0; i < functions.length; i += batchSize) {
    const batch = functions.slice(i, i + batchSize);

    const validationPrompt = `
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

For each function, determine if its summary is related to the description.

Return true if related, false otherwise.
`;

    try {
      const result = await generateObject({
        model: claude,
        system: `
        You are a distinguished software engineer analyzing a codebase. Your task is to identify functions that are semantically related to a given description, even if they don't directly perform that action. This includes functions that:
        - Directly perform the described action
        - Handle, validate, or process the described action
        - Warn about or prevent improper usage of the described action
        - Are part of the workflow or lifecycle of the described action

        Be inclusive rather than restrictive in your evaluation.
        `,
        prompt: validationPrompt,
        providerOptions: {
          thinking: { type: "enabled", budgetTokens: 12000 },
        } satisfies AnthropicProviderOptions,
        schema: z.object({
          evaluations: z.array(
            z.object({
              functionIndex: z.number(),
              matches: z.boolean(),
            }),
          ),
        }),
      });
      totalTokens += result.usage.totalTokens;

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

  return { functions: validatedFunctions, totalTokens };
}

export async function getSimilarFunctions(description: string) {
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
  return await batchValidateFunctions(description, allResults);
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
    {
      function_description: z
        .string()
        .describe(
          "A clear, specific description of what kind of functions to find. This should describe the function's characteristics in terms of:\n\n**What to include:**\n- Function purpose/behavior (e.g., 'validates user input', 'processes arrays', 'handles HTTP requests')\n- Parameter types (e.g., 'accepts array parameter', 'takes string and number arguments')\n- Return types (e.g., 'returns boolean', 'returns Promise')\n- Functional patterns (e.g., 'callback functions', 'async operations', 'event handlers')\n- Data operations (e.g., 'transforms data', 'filters collections', 'sorts arrays')\n\n**Examples of good descriptions:**\n- 'functions that accept an array as a parameter'\n- 'functions that validate or sanitize user input'\n- 'async functions that make HTTP requests'\n- 'functions that return Promise objects'\n- 'callback functions for event handling'\n- 'functions that transform or map data structures'\n- 'utility functions for string manipulation'\n\n**Examples of poor descriptions:**\n- 'good functions' (too vague)\n- 'important stuff' (not descriptive)\n- 'functions' (too broad)\n\n**Tips for better results:**\n- Be specific about what the function does or handles\n- Include parameter/return type information when relevant\n- Use technical terms that would appear in function summaries\n- Focus on functionality rather than implementation details",
        ),
    },
    async ({ function_description }: { function_description: string }) => {
      try {
        const result = await getSimilarFunctions(function_description);

        if (result.functions.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No similar functions found for the given description.",
              },
            ],
          };
        }

        const formattedResponse = result.functions
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
              text: `Found ${result.functions.length} similar functions:\n\n${formattedResponse}`,
            },
            {
              type: "text",
              text: `Total tokens used while classifying functions: ${result.totalTokens}`,
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
