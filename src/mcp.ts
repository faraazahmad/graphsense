import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { executeQuery, db, setupDB } from "./db";
import { PINECONE_API_KEY } from "./env";
import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

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

  const topK = 10;

  // Use pgvector cosine similarity to find similar functions
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
    LIMIT $2
  `,
    [JSON.stringify(queryEmbedding), topK],
  );

  // Extract results for reranking
  const results = similarityResults.rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    path: row.path,
    name: row.name,
    start_line: row.start_line,
    end_line: row.end_line,
    similarity_score: row.similarity_score,
  }));

  return results;
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
    "To search for functions in the codebase based on what they do.",
    {
      function_description: z
        .string()
        .describe("description of the task performed by the function"),
      topK: z.number().describe("Number of results to return (default: 10)"),
    },
    async ({
      function_description,
      topK = 10,
    }: {
      function_description: string;
      topK?: number;
    }) => {
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
              `${index + 1}. **${func.name}** (ID: ${func.id})\n` +
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
      functionId: z
        .string()
        .describe("The element ID of the function to find callers for"),
    },
    async ({ functionId }: { functionId: string }) => {
      try {
        const result = await executeQuery(
          `
          MATCH (caller:Function)-[:CALLS]->(target:Function)
          WHERE elementId(target) = $functionId
          RETURN elementId(caller) as id, caller.name as name, caller.path as path, caller.summary as summary
          `,
          { functionId },
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
              `${index + 1}. **${record.get("name") || "Unknown"}** (ID: ${record.get("id")})\n` +
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
      functionId: z
        .string()
        .describe("The element ID of the function to find callees for"),
    },
    async ({ functionId }: { functionId: string }) => {
      try {
        const result = await executeQuery(
          `
          MATCH (source:Function)-[:CALLS]->(callee:Function)
          WHERE elementId(source) = $functionId
          RETURN elementId(callee) as callee_id, callee.name as name, callee.path as path, callee.summary as summary
          `,
          { functionId },
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
              `${index + 1}. **${record.get("name") || "Unknown"}** (ID: ${record.get("callee_id")})\n` +
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

  // Add function details tool
  server.tool(
    "function_details",
    "Get detailed information about a specific function",
    {
      functionId: z
        .string()
        .describe("The element ID of the function to get details for"),
    },
    async ({ functionId }: { functionId: string }) => {
      try {
        const result = await db.relational.client!.query(
          `SELECT id, name, path, summary FROM functions WHERE id = $1 LIMIT 1`,
          [functionId],
        );

        const functionData = result.rows[0];
        if (!functionData) {
          return {
            content: [
              {
                type: "text",
                text: `Function with ID ${functionId} not found`,
              },
            ],
          };
        }

        const formattedResponse =
          `**Function Details:**\n\n` +
          `- **Name:** ${functionData.name || "Unknown"}\n` +
          `- **ID:** ${functionData.id}\n` +
          `- **Path:** ${functionData.path || "Unknown"}\n` +
          `- **Summary:** ${functionData.summary || "No summary available"}`;

        return {
          content: [
            {
              type: "text",
              text: formattedResponse,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting function details: ${error}`,
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
