import Fastify from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { executeQuery, db } from "./db";
import { getRepoQualifier, CO_API_KEY } from "./env";
import { getRepoPath } from "./index";
import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({ token: CO_API_KEY });

// Create Fastify instance
const fastify = Fastify({
  logger: true,
});

export async function getSimilarFunctions(description: string) {
  console.log(description);

  // Generate embedding for the search query using Cohere
  const embeddingResponse = await cohere.v2.embed({
    model: "embed-english-v3.0",
    texts: [description],
    inputType: "search_query",
    embeddingTypes: ["float"],
  });

  const queryEmbedding = embeddingResponse.embeddings.float![0];

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

  // Rerank using Cohere
  const cohereResponse = await cohere.v2.rerank({
    model: "rerank-v3.5",
    query: description,
    topN: Math.min(topK, results.length),
    documents: results.map((res) => res.text),
  });

  // Map reranked results back to function data
  const reRanked = cohereResponse.results.map((row) => results[row.index]);

  const rankedFunctions = reRanked.map((func) => ({
    id: func.id,
    path: func.path,
    name: func.name,
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

// Global server instance
const server = createMcpServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => `session-${Date.now()}-${Math.random()}`,
});

// Connect server to transport once at startup
server.connect(transport);

// Handle MCP requests (POST, GET, DELETE)
fastify.route({
  method: ['POST', 'GET', 'DELETE'],
  url: '/mcp',
  config: {
    rawBody: true,
  },
  handler: async (request, reply) => {
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!reply.sent) {
        reply.status(500).send({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  }
});

// Health check endpoint
fastify.get("/health", async (request, reply) => {
  return {
    status: "ok",
    service: "GraphSense MCP Server",
    version: "1.0.0",
  };
});

// Start the server
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

if (require.main === module) {
  const start = async () => {
    try {
      // Register CORS
      await fastify.register(import("@fastify/cors"), {
        origin: true,
        credentials: true,
      });

      await fastify.listen({ port: PORT, host: HOST });
      console.log(`GraphSense MCP Server listening on http://${HOST}:${PORT}`);
      console.log(`Health check available at: http://${HOST}:${PORT}/health`);
      console.log(`MCP endpoint available at: http://${HOST}:${PORT}/mcp`);
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  start();
}

export { fastify, createMcpServer };
