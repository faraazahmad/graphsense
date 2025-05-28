import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeQuery, db } from "./db";
import { getSimilarFunctions } from "./api";

// Create an MCP server
const server = new McpServer({
  name: "Code Graph RAG",
  version: "1.0.0",
});

// Add similar functions search tool
server.tool(
  "similar_functions",
  {
    description: z
      .string()
      .describe("Description of the functions to search for"),
    topK: z
      .number()
      .optional()
      .describe("Number of results to return (default: 10)"),
  },
  async ({ description, topK = 10 }) => {
    try {
      const functions = await getSimilarFunctions(description);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(functions.slice(0, topK), null, 2),
          },
        ],
      };
    } catch (error) {
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

// Add a dynamic greeting resource
server.resource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  async (uri, { name }) => ({
    contents: [
      {
        uri: uri.href,
        text: `Hello, ${name}!`,
      },
    ],
  }),
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => console.log("MCP server running"))
  .catch((err) => console.error(err));
