import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
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

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

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
    name: "GraphSense MCP HTTP (Fastify)",
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
    async ({ function_description, topK = 10 }) => {
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
    async ({ functionId }) => {
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
    async ({ functionId }) => {
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
    async ({ functionId }) => {
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

// Handle POST requests for client-to-server communication
fastify.post("/mcp", async (request, reply) => {
  try {
    // Check for existing session ID
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(request.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          transports[sessionId] = transport;
          console.log(`New MCP session initialized: ${sessionId}`);
        },
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`MCP session closed: ${transport.sessionId}`);
          delete transports[transport.sessionId];
        }
      };

      const server = createMcpServer();
      // Connect to the MCP server
      await server.connect(transport);
    } else {
      // Invalid request
      reply.status(400).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Bad Request: No valid session ID provided or not an initialize request",
        },
        id: null,
      });
      return;
    }

    // Convert Fastify request/reply to Express-like format for the transport
    const expressLikeReq = {
      ...request,
      headers: request.headers,
      body: request.body,
      method: request.method,
      url: request.url,
    };

    const expressLikeRes = {
      status: (code: number) => {
        reply.status(code);
        return expressLikeRes;
      },
      json: (data: any) => {
        reply.send(data);
        return expressLikeRes;
      },
      send: (data: any) => {
        reply.send(data);
        return expressLikeRes;
      },
      setHeader: (name: string, value: string) => {
        reply.header(name, value);
        return expressLikeRes;
      },
      writeHead: (statusCode: number, headers?: any) => {
        reply.status(statusCode);
        if (headers) {
          Object.entries(headers).forEach(([key, value]) => {
            reply.header(key, value as string);
          });
        }
        return expressLikeRes;
      },
      write: (chunk: any) => {
        reply.raw.write(chunk);
        return expressLikeRes;
      },
      end: (data?: any) => {
        if (data) {
          reply.send(data);
        } else {
          reply.raw.end();
        }
        return expressLikeRes;
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        reply.raw.on(event, listener);
        return expressLikeRes;
      },
      headersSent: reply.sent,
    };

    // Handle the request
    await transport.handleRequest(
      expressLikeReq as any,
      expressLikeRes as any,
      request.body,
    );
  } catch (error) {
    console.error("Error handling MCP POST request:", error);
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
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (request: any, reply: any) => {
  try {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      reply.status(400).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Invalid or missing session ID",
        },
        id: null,
      });
      return;
    }

    const transport = transports[sessionId];

    // Convert Fastify request/reply to Express-like format
    const expressLikeReq = {
      ...request,
      headers: request.headers,
      method: request.method,
      url: request.url,
    };

    const expressLikeRes = {
      status: (code: number) => {
        reply.status(code);
        return expressLikeRes;
      },
      json: (data: any) => {
        reply.send(data);
        return expressLikeRes;
      },
      send: (data: any) => {
        reply.send(data);
        return expressLikeRes;
      },
      setHeader: (name: string, value: string) => {
        reply.header(name, value);
        return expressLikeRes;
      },
      writeHead: (statusCode: number, headers?: any) => {
        reply.status(statusCode);
        if (headers) {
          Object.entries(headers).forEach(([key, value]) => {
            reply.header(key, value as string);
          });
        }
        return expressLikeRes;
      },
      write: (chunk: any) => {
        reply.raw.write(chunk);
        return expressLikeRes;
      },
      end: (data?: any) => {
        if (data) {
          reply.send(data);
        } else {
          reply.raw.end();
        }
        return expressLikeRes;
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        reply.raw.on(event, listener);
        return expressLikeRes;
      },
      headersSent: reply.sent,
    };

    await transport.handleRequest(expressLikeReq as any, expressLikeRes as any);
  } catch (error) {
    console.error("Error handling MCP session request:", error);
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
};

// Handle GET requests for server-to-client notifications via SSE
fastify.get("/mcp", async (request, reply) => {
  try {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      reply.status(400).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Invalid or missing session ID",
        },
        id: null,
      });
      return;
    }

    const transport = transports[sessionId];

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // Send initial connection event
    reply.raw.write('data: {"type":"connected"}\n\n');

    // Convert Fastify request/reply to Express-like format with SSE support
    const expressLikeReq = {
      ...request,
      headers: request.headers,
      method: request.method,
      url: request.url,
    };

    const expressLikeRes = {
      status: (code: number) => {
        // For SSE, we don't change status after headers are sent
        return expressLikeRes;
      },
      json: (data: any) => {
        // Send JSON data as SSE event
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        return expressLikeRes;
      },
      send: (data: any) => {
        // Send data as SSE event
        const dataStr = typeof data === "string" ? data : JSON.stringify(data);
        reply.raw.write(`data: ${dataStr}\n\n`);
        return expressLikeRes;
      },
      setHeader: (name: string, value: string) => {
        // Headers already sent for SSE
        return expressLikeRes;
      },
      writeHead: (statusCode: number, headers?: any) => {
        // Headers already sent for SSE
        return expressLikeRes;
      },
      write: (chunk: any) => {
        // Write as SSE data
        const dataStr =
          typeof chunk === "string" ? chunk : JSON.stringify(chunk);
        reply.raw.write(`data: ${dataStr}\n\n`);
        return expressLikeRes;
      },
      end: (data?: any) => {
        if (data) {
          const dataStr =
            typeof data === "string" ? data : JSON.stringify(data);
          reply.raw.write(`data: ${dataStr}\n\n`);
        }
        reply.raw.end();
        return expressLikeRes;
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        reply.raw.on(event, listener);
        return expressLikeRes;
      },
      headersSent: true, // Headers are always sent for SSE
    };

    // Handle client disconnect
    request.raw.on("close", () => {
      console.log(`SSE client disconnected for session: ${sessionId}`);
    });

    request.raw.on("error", (err) => {
      console.error(`SSE client error for session ${sessionId}:`, err);
    });

    // Keep connection alive with periodic heartbeat
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(": heartbeat\n\n");
      } else {
        clearInterval(heartbeat);
      }
    }, 30000); // Send heartbeat every 30 seconds

    // Clean up heartbeat on connection close
    reply.raw.on("close", () => {
      clearInterval(heartbeat);
    });

    await transport.handleRequest(expressLikeReq as any, expressLikeRes as any);
  } catch (error) {
    console.error("Error handling MCP SSE request:", error);
    if (!reply.raw.destroyed) {
      reply.raw.write(
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        })}\n\n`,
      );
      reply.raw.end();
    }
  }
});

// Handle DELETE requests for session termination
fastify.delete("/mcp", handleSessionRequest);

// Health check endpoint
fastify.get("/health", async (request, reply) => {
  return {
    status: "ok",
    service: "GraphSense MCP HTTP Server (Fastify)",
    version: "1.0.0",
    activeSessions: Object.keys(transports).length,
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
      console.log(
        `GraphSense MCP HTTP Server (Fastify) listening on http://${HOST}:${PORT}`,
      );
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
