import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { executeQuery, db } from "./db";
import { PINECONE_API_KEY } from "./env";
import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

const index = pinecone.Index("function-embeddings");

export async function getSimilarFunctions(description: string) {
  console.log(description);

  // Generate embedding for the search query using Pinecone
  const embeddingResponse = await pinecone.inference.embed(
    "multilingual-e5-large",
    [description],
    { inputType: "query" }
  );

  // Handle both dense and sparse embeddings
  let queryEmbedding: number[] = [];
  if (embeddingResponse.data && embeddingResponse.data.length > 0) {
    const embeddingData = embeddingResponse.data[0];
    if ('values' in embeddingData) {
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
    text: row.summary,
    path: row.path,
    name: row.name,
    similarity_score: row.similarity_score,
  }));

  if (results.length === 0) {
    return [];
  }

  // Use Pinecone similarity scores for ranking (already sorted by similarity)
  const rankedFunctions = results.slice(0, Math.min(topK, results.length)).map((func) => ({
    id: func.id,
    path: func.path,
    name: func.name,
    similarity_score: func.similarity_score,
  }));

  return Promise.resolve(rankedFunctions);
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
    async ({ function_description, topK = 10 }: { function_description: string; topK?: number }) => {
      try {
        const functions = await getSimilarFunctions(function_description);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(functions),
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
          RETURN caller.name as caller_name, elementId(caller) as caller_id
          `,
          { functionId },
        );

        const callers = result.records.map((record) => ({
          id: record.get("caller_id"),
          name: record.get("caller_name"),
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(callers, null, 2),
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
          RETURN callee.name as callee_name, elementId(callee) as callee_id
          `,
          { functionId },
        );

        const callees = result.records.map((record) => ({
          id: record.get("callee_id"),
          name: record.get("callee_name"),
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(callees, null, 2),
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
          `SELECT id, name, code, summary FROM functions WHERE id = $1 LIMIT 1`,
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

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(functionData, null, 2),
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
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport);
  console.log("GraphSense MCP Server running on stdio");
}

export { createMcpServer };
