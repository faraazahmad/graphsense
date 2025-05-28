import "dotenv/config";
// Import the framework and instantiate it
import Fastify, { FastifyRequest } from "fastify";
import { FastifySSEPlugin } from "fastify-sse-v2";
import fastifyCors from "@fastify/cors";
import { executeQuery, pc, db, setupDB, vectorNamespace } from "./db";
import neo4j, { Record, Node, Relationship } from "neo4j-driver";
import { makeQueryDecision, plan } from "./planner";
import { generateText, streamText, tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  claude,
  gemini,
  getRepoQualifier,
  REPO_PATH,
  REPO_URI,
  SERVICE_PORT,
} from "./env";
import { anthropic } from "@ai-sdk/anthropic";
import type { Hit } from "@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch/db_data";
import { z } from "zod";
import { globSync } from "fs";
import { CohereClient } from "cohere-ai";
import { prePass } from ".";
import { getSimilarFunctions } from "./tools";

const cohere = new CohereClient({ token: process.env["COHERE_API_KEY"] });

let fastify = Fastify({ logger: true });
fastify.register(FastifySSEPlugin);
fastify.register(fastifyCors, { origin: "*", methods: "*" });

export interface GraphNode {
  id: string;
  labels: string[];
  name: string;
  path: string;
}

export interface GraphRelationship {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: any;
}

/**
 * Extracts unique nodes and relationships from Neo4j query records,
 * filtering nodes by allowedLabels and relationships by allowedTypes.
 *
 * @param records Neo4j query result records
 * @param allowedNodeLabels List of node labels to include (if empty, includes all)
 * @param allowedRelTypes List of relationship types to include (if empty, includes all)
 * @returns Object with arrays of unique nodes and relationships
 */
export function extractGraphElements(
  records: Record[],
  allowedNodeLabels: string[] = [],
  allowedRelTypes: string[] = [],
): { nodes: GraphNode[]; relationships: GraphRelationship[] } {
  const nodesMap = new Map<string, GraphNode>();
  const relationshipsMap = new Map<string, GraphRelationship>();

  for (const record of records) {
    for (const key of record.keys) {
      const value = record.get(key) as GraphNode;

      // Check if value is a Node
      if (value instanceof neo4j.types.Node) {
        // If allowedNodeLabels is empty or node has at least one allowed label
        if (
          allowedNodeLabels.length === 0 ||
          value.labels.some((label) => allowedNodeLabels.includes(label))
        ) {
          const id = value.elementId;
          if (!nodesMap.has(id)) {
            nodesMap.set(id, {
              id,
              labels: value.labels,
              name: value.properties.name,
              path: value.properties.path,
            });
          }
        }
      }

      // Check if value is a Relationship
      else if (value instanceof neo4j.types.Relationship) {
        // If allowedRelTypes is empty or relationship type is allowed
        if (
          allowedRelTypes.length === 0 ||
          allowedRelTypes.includes(value.type)
        ) {
          const id = value.elementId;
          if (!relationshipsMap.has(id)) {
            relationshipsMap.set(id, {
              id,
              type: value.type,
              source: value.startNodeElementId,
              target: value.endNodeElementId,
              properties: value.properties,
            });
          }
        }
      }
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    relationships: Array.from(relationshipsMap.values()),
  };
}

interface QueryAnswerStreamData {
  query: string;
  nodes: any[];
  relationships: any[];
}
fastify.put(
  "/prompt",
  async function handler(
    request: FastifyRequest<{ Body: QueryAnswerStreamData }>,
    reply,
  ) {
    const { query, nodes, relationships } = request.body;

    const prompt = `
        You are a neo4j and systems architecture expert, working with the following database:

        Database schema:
        - Nodes:
          - (File) nodes have a 'path' property (string).
          - (Function) nodes have 'name' (string) and 'path' (string) properties.
        - Relationships:
          - (File)-[:IMPORTS_FROM { clause: string }]->(File)
            * The 'clause' property indicates the name of the function imported.
          - (Function)-[:CALLS]->(Function)

        The follwing search query was made by the user: ${query}

        For the given DB, the answer is given in the follwing nodes and relationships:
        Nodes: ${JSON.stringify(nodes)}
        Relationships: ${JSON.stringify(relationships)}

        Answer the user query in natural language using the given data.
    `;
    const claude = anthropic("claude-3-5-sonnet-latest");
    const googleAI = createGoogleGenerativeAI({
      apiKey: process.env["GOOGLE_GENERATIVE_AI_API_KEY"],
    });
    const gemini = googleAI("gemini-2.0-flash-lite-preview-02-05");
    const { textStream } = streamText({ model: gemini, prompt });

    return reply
      .header("Content-Type", "application/octet-stream")
      .send(textStream);
  },
);

interface VectorSearchQuery {
  text: string;
}
fastify.get<{ Querystring: VectorSearchQuery }>(
  "/vector",
  async function handler(request, reply) {
    const { text } = request.query;

    const query = decodeURI(text);
    const decisionMd = await makeQueryDecision(query);
    const decision = decisionMd.replace(/```/g, "").replace(/json/, "");

    reply.send(decision);
  },
);

interface PlanQuery {
  queryText: string;
}
fastify.get<{ Querystring: PlanQuery }>(
  "/decide",
  async function handler(request, reply) {
    const { queryText } = request.query;

    const query = decodeURI(queryText);
    const decisionMd = await makeQueryDecision(query);
    const decision = decisionMd.replace(/```/g, "").replace(/json/, "");

    reply.send(decision);
  },
);

interface PlanQuery {
  userQuery: string;
  description: string;
  decision: string;
}
fastify.get<{ Querystring: PlanQuery }>(
  "/plan",
  async function handler(request, reply) {
    const { userQuery, description, decision } = request.query;

    const query = decodeURI(userQuery);

    let result;
    let queryMD;
    let error: Error | undefined;
    let cypherQuery;

    let functions: any[] = [];
    if (decision === "sql") {
      functions = await getSimilarFunctions(description);
    }
    queryMD = await plan(query, error, functions, description);
    cypherQuery = queryMD.replace(/```/g, "").replace(/cypher/, "");
    console.log(cypherQuery);
    result = await executeQuery(cypherQuery, {});

    // while (true) {
    //     // makeQueryDecision(query);
    //     queryMD = await plan(query, error);
    //     cypherQuery = queryMD.replace(/```/g, '').replace(/cypher/, '')
    //     try {
    //         result = await executeQuery(cypherQuery, {});
    //     } catch (err) {
    //         error = err as Error;
    //         console.log(error.message)
    //         continue;
    //     }
    //
    //     break;
    // }

    const { nodes, relationships } = extractGraphElements(
      result.records,
      ["File", "Function"],
      ["CALLS", "IMPORTS_FROM"],
    );
    return reply.send({ nodes, relationships });
  },
);

export interface SearchResult {
  result: {
    hits: Hit[];
  };
  usage: any;
}

export interface ChunkOutput {
  _id: string;
  text: string;
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
  const namespace = getRepoQualifier(REPO_URI).replace("/", "-");
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
    `SELECT id, name FROM functions where id in (${ids});`,
  );
  const functionsMap: any = {};
  for (const func of functionsResult.rows) {
    functionsMap[func.id] = func;
  }

  const rankedFunctions = rankedIds
    .map((id) => ({
      id,
      name: functionsMap[id]?.name,
    }))
    .filter((func) => func.name);
  return Promise.resolve(rankedFunctions);
}

interface ChatQuery {
  description: string;
}
interface ChatRouteParams {
  query_id: string;
}
fastify.get<{ Querystring: ChatQuery; Params: ChatRouteParams }>(
  "/chat/query/:query_id",
  async function handler(request, reply) {
    const { description } = request.query;
    const { query_id } = request.params;

    if (reply.raw.destroyed) {
      return;
    }

    const decodedDescription = decodeURI(description);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Prevents Nginx from buffering the response
      "Access-Control-Allow-Origin": "*", // Allow any origin to connect
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });

    const { textStream } = streamText({
      model: claude,
      tools: {
        create_execution_plan: tool({
          description:
            "Breaks down a complex query into sequential steps for execution",
          parameters: z.object({ expression: z.string() }),
          execute: async ({ expression }) => expression,
        }),
        similar_functions: tool({
          description:
            `A tool for searching functions based on their semantic meaning` +
            `<example>  Query: All functions that deal with dependencies.
                            Answer: manage dependencies
                </example>`,
          parameters: z.object({ expression: z.string() }),
          execute: async ({ expression }) => getSimilarFunctions(expression),
        }),
        function_connections: tool({
          description:
            `A tool to use when connections between functions need to be found (via calls).` +
            `<example>  Query: Which functions have more than 5+ callers?
                            Answer: Functions that have more than 5 other functions calling them.
                </example>`,
          parameters: z.object({ expression: z.string() }),
          execute: async ({ expression }) => {
            let error;

            while (true) {
              const queryMD = await plan(expression, error);
              const cypherQuery = queryMD
                .replace(/```/g, "")
                .replace(/cypher/, "");
              console.log(cypherQuery);
              try {
                const result = await executeQuery(cypherQuery, {});
                const { nodes, relationships } = extractGraphElements(
                  result.records,
                  ["File", "Function"],
                  ["CALLS", "IMPORTS_FROM"],
                );
                return { nodes, relationships };
              } catch (err) {
                error = err as Error;
                continue;
              }
            }
          },
        }),
      },
      onError({ error }) {
        console.error(error);
        // reply.send(500);
      },
      onStepFinish({ toolResults }) {
        if (!toolResults) return;

        const data = JSON.stringify({ type: "tool_result", data: toolResults });
        reply.raw.write(`data: ${data}\n\n`);
      },
      maxSteps: 10,
      system:
        "You are a Linux and systems expert " +
        "First create a plan, then reason step by step. " +
        "Use only the tools necessary for the task, but don't mention the name of the tools you're using." +
        "When you give the final answer, " +
        "provide an explanation for how you arrived at it.",
      prompt: `Query: ${decodedDescription}`,
    });

    for await (const value of textStream) {
      const data = JSON.stringify({ type: "text_chunk", data: value });
      reply.raw.write(`data: ${data}\n\n`);
    }

    if (!reply.raw.destroyed) {
      reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      // return reply;
    }
  },
);

interface SearchQuery {
  description: string;
}
fastify.get<{ Querystring: SearchQuery }>(
  "/functions/search",
  async function handler(request, reply) {
    const { description } = request.query;

    const decodedDescription = decodeURI(description);
    const result = await getSimilarFunctions(decodedDescription);

    return reply.send(result);
  },
);

export function getRelationData(relation: Relationship) {
  const { type, startNodeElementId, endNodeElementId } = relation;
  return { type, source: startNodeElementId, target: endNodeElementId };
}

export interface FunctionData {
  id: string;
  name: string;
}
export type FunctionDataResult = {
  [key: string]: FunctionData;
};

export function getFunctionData(functionNode: Node): FunctionData {
  const { elementId, properties } = functionNode;
  return { id: elementId, name: properties.name };
}

interface FunctionRouteParams {
  id: string;
}
fastify.get<{ Params: FunctionRouteParams }>(
  "/functions/:id",
  async (request, reply) => {
    const { id } = request.params;
    const result = await db.relational.client!.query(
      `select id, name, code, summary from functions where id = $1 limit 1`,
      [id],
    );
    const functionData = result.rows[0];

    const functionCallsResult = await executeQuery(
      `
        match
            (func1:Function)-[rel:CALLS]->(func2:Function)
        where elementId(func1) = $id or elementId(func2) = $id
        return func1, func2, rel
    `,
      { id },
    );

    const nodes: FunctionDataResult = {};
    functionCallsResult.records.forEach((rec) => {
      const func1 = getFunctionData(rec.get("func1")) as FunctionData;
      nodes[func1.id] = func1;

      const func2 = getFunctionData(rec.get("func2")) as FunctionData;
      nodes[func2.id] = func2;
    });
    const links = functionCallsResult.records.map((rec) =>
      getRelationData(rec.get("rel") as Relationship),
    );

    return reply.send({ info: functionData, nodes, links });
  },
);

prePass()
  .then(() => {
    fastify.listen({ port: SERVICE_PORT });
  })
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
