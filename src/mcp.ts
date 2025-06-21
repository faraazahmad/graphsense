import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Hit } from "@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch/db_data";
import { executeQuery, db, pc } from "./db";
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

interface ChunkOutput {
  _id: string;
  text: string;
}
interface SearchResult {
  result: {
    hits: Hit[];
  };
  usage: any;
}
/**
 * Get the unique hits from two search results and return them as single array of {'_id', 'chunk_text'} dicts.
 */
export function mergeChunks(h1: SearchResult, h2: SearchResult): ChunkOutput[] {
  // Deduplicate by _id
  const hitsMap = new Map<string, Hit>();

  // Combine hits from both results
  [...h1.result.hits, ...h2.result.hits].forEach((hit) => {
    hitsMap.set(hit._id, hit);
  });

  // Convert map values to array
  const deduped = Array.from(hitsMap.values());

  // Sort by _score descending
  const sortedHits = deduped.sort((a, b) => b._score - a._score);

  // Transform to format for reranking
  const result = sortedHits.map((hit) => ({
    _id: hit._id,
    text: (hit.fields as any).text,
  }));

  return result;
}
export async function getSimilarFunctions(description: string) {
  console.log(description);
  const namespace = getRepoQualifier(getRepoPath()).replace("/", "-");
  const denseIndex = pc.index("graphsense-dense").namespace(namespace);
  const sparseIndex = pc.index("graphsense-sparse").namespace(namespace);

  let denseResults;
  let sparseResults;
  const topK = 10;
  await Promise.all([
    denseIndex
      .searchRecords({
        query: { inputs: { text: description }, topK },
        fields: ["id", "text"],
      })
      .then((res) => (denseResults = res)),

    sparseIndex
      .searchRecords({
        query: { inputs: { text: description }, topK },
        fields: ["id", "text"],
      })
      .then((res) => (sparseResults = res)),
  ]);

  const mergedResults = mergeChunks(denseResults!, sparseResults!);
  const cohereResponse = await cohere.v2.rerank({
    model: "rerank-v3.5",
    query: description,
    topN: topK,
    documents: mergedResults.map((res) => res.text),
  });

  const reRanked = cohereResponse.results.map(
    (row) => mergedResults[row.index],
  );
  const rankedIds = reRanked.map((row) => row._id);
  const ids = rankedIds.map((id) => `'${id}'`).join(",");

  const functionsResult = await db.relational.client!.query(
    `SELECT id, path, name FROM functions where id in (${ids});`,
  );
  const functionsMap: any = {};
  for (const func of functionsResult.rows) {
    functionsMap[func.id] = func;
  }

  const rankedFunctions = rankedIds
    .map((id) => ({
      id: functionsMap[id]?.id,
      path: functionsMap[id]?.path,
      name: functionsMap[id]?.name,
    }))
    .filter((func) => func.name);
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
fastify.get("/mcp", handleSessionRequest);

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
const HOST = process.env.HOST || "localhost";

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
