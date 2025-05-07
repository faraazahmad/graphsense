import 'dotenv/config';
// Import the framework and instantiate it
import Fastify, { FastifyRequest } from 'fastify'
import { ollama } from 'ollama-ai-provider';
import fastifyCors from '@fastify/cors';
import { executeQuery, pc, pgClient, setupDB, vectorNamespace } from './db';
import neo4j, { Record, Node, Relationship } from 'neo4j-driver';
import { makeQueryDecision, plan } from './planner';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { SERVICE_PORT } from './env';
import { anthropic } from '@ai-sdk/anthropic';
import type { Hit } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch/db_data';

let fastify = Fastify({
    logger: true
});
fastify.register(fastifyCors, {
    origin: "*",
    methods: "*"
});

const embeddingModel = ollama('nomic-embed-text');

interface GraphNode {
    id: string;
    labels: string[];
    properties: any;
}

interface GraphRelationship {
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
function extractGraphElements(
    records: Record[],
    allowedNodeLabels: string[] = [],
    allowedRelTypes: string[] = []
): { nodes: GraphNode[]; relationships: GraphRelationship[] } {
    const nodesMap = new Map<string, GraphNode>();
    const relationshipsMap = new Map<string, GraphRelationship>();

    for (const record of records) {
        for (const key of record.keys) {
            const value = record.get(key);

            // Check if value is a Node
            if (value instanceof neo4j.types.Node) {
                // If allowedNodeLabels is empty or node has at least one allowed label
                if (
                    allowedNodeLabels.length === 0 ||
                    value.labels.some(label => allowedNodeLabels.includes(label))
                ) {
                    const id = value.elementId;
                    if (!nodesMap.has(id)) {
                        nodesMap.set(id, {
                            id,
                            labels: value.labels,
                            ...value.properties,
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

interface QueryAnswerStreamData { query: string, nodes: any[], relationships: any[] }
fastify.put('/prompt', async function handler(request: FastifyRequest<{ Body: QueryAnswerStreamData }>, reply) {
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
    const claude = anthropic('claude-3-5-sonnet-latest');
    const googleAI = createGoogleGenerativeAI({ apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'] });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    const { textStream } = streamText({ model: gemini, prompt });

    return reply.header('Content-Type', 'application/octet-stream').send(textStream);
});

interface VectorSearchQuery { text: string }
fastify.get<{ Querystring: VectorSearchQuery }>('/vector', async function handler(request, reply) {
    const { text } = request.query;

    const query = decodeURI(text)
    const decisionMd = await makeQueryDecision(query);
    const decision = decisionMd.replace(/```/g, '').replace(/json/, '')

    reply.send(decision);
});

interface PlanQuery { queryText: string }
fastify.get<{ Querystring: PlanQuery }>('/decide', async function handler(request, reply) {
    const { queryText } = request.query;

    const query = decodeURI(queryText)
    const decisionMd = await makeQueryDecision(query);
    const decision = decisionMd.replace(/```/g, '').replace(/json/, '')

    reply.send(decision);
});

interface PlanQuery { userQuery: string, description: string, decision: string }
fastify.get<{ Querystring: PlanQuery }>('/plan', async function handler(request, reply) {
    const { userQuery, description, decision } = request.query;

    const query = decodeURI(userQuery)

    let result;
    let queryMD
    let error: (Error | undefined);
    let cypherQuery;

    let functions: any[] = [];
    if (decision === 'sql') {
        functions = await getSimilarFunctions(description);
    }
    queryMD = await plan(query, error, functions, description);
    cypherQuery = queryMD.replace(/```/g, '').replace(/cypher/, '')
    console.log(cypherQuery)
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
        ['File', 'Function'],
        ['CALLS', 'IMPORTS_FROM']
    );
    return reply.send({ nodes, relationships });
})

interface SearchResult {
    result: {
        hits: Hit[];
    },
    usage: any
}

interface ChunkOutput {
    _id: string;
    text: string;
}

/**
 * Get the unique hits from two search results and return them as single array of {'_id', 'chunk_text'} dicts.
 */
function mergeChunks(h1: SearchResult, h2: SearchResult): ChunkOutput[] {
    // Deduplicate by _id
    const hitsMap = new Map<string, Hit>();

    // Combine hits from both results
    [...h1.result.hits, ...h2.result.hits].forEach(hit => {
        hitsMap.set(hit._id, hit);
    });

    // Convert map values to array
    const deduped = Array.from(hitsMap.values());

    // Sort by _score descending
    const sortedHits = deduped.sort((a, b) => b._score - a._score);

    // Transform to format for reranking
    const result = sortedHits.map(hit => ({
        _id: hit._id,
        text: (hit.fields as any).text
    }));

    return result;
}

async function getSimilarFunctions(description: string) {
    // const model = ollama.embedding(embeddingModel.modelId);
    // const { embeddings } = await model.doEmbed({
    //     values: [description]
    // });
    //
    // const result = await pgClient.query(`SELECT id, name FROM functions ORDER BY embedding <=> '${JSON.stringify(embeddings[0])}' LIMIT 7;`)
    //
    // return Promise.resolve(result.rows);
    const denseIndex = pc.index('graphsense-dense').namespace('svelte')
    const sparseIndex = pc.index('graphsense-sparse').namespace('svelte')

    let denseResults;
    let sparseResults;
    await Promise.all([
        denseIndex.searchRecords({ query: { inputs: { text: description }, topK: 10 }, fields: ['id', 'text'] })
        .then(res => denseResults = res),

        sparseIndex.searchRecords({ query: { inputs: { text: description }, topK: 10 }, fields: ['id', 'text'] })
        .then(res => sparseResults = res),
    ])
    // console.log(denseResults!.result.hits[0])
    // console.log(sparseResults)

    const mergedResults = mergeChunks(denseResults!, sparseResults!);
    const reRanked = await pc.inference.rerank('bge-reranker-v2-m3', description, mergedResults as any[]);
    const rankedIds = reRanked.data.map(row => row.document!._id);

    const ids = reRanked.data.map(d => `'${d.document!._id}'`).join(',');
    const functionsResult = await pgClient.query(`SELECT id, name FROM functions where id in (${ids});`);
    const functionsMap: any = {};
    for (const func of functionsResult.rows) { functionsMap[func.id] = func; }

    const rankedFunctions = rankedIds.map(id => ({
        id,
        name: functionsMap[id]?.name
    })).filter(func => func.name);
    return Promise.resolve(rankedFunctions);
}


interface SearchQuery { description: string }
fastify.get<{ Querystring: SearchQuery }>('/functions/search', async function handler(request, reply) {
    const { description } = request.query;

    const decodedDescription = decodeURI(description);
    const result = await getSimilarFunctions(decodedDescription);

    return reply.send(result);
})

function getRelationData(relation: Relationship) {
    const { type, startNodeElementId, endNodeElementId } = relation;
    return { type, source: startNodeElementId, target: endNodeElementId };
}

interface FunctionData {
    id: string
    name: string
}
type FunctionDataResult = {
    [key: string]: FunctionData
}

function getFunctionData(functionNode: Node): FunctionData {
    const { elementId, properties } = functionNode;
    return { id: elementId, name: properties.name };
}

interface FunctionRouteParams { id: string }
fastify.get<{ Params: FunctionRouteParams }>('/functions/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await pgClient.query(`select id, name, code, summary from functions where id = $1 limit 1`, [id]);
    const functionData = result.rows[0];

    const functionCallsResult = await executeQuery(
        `
        match
            (func1:Function)-[rel:CALLS]->(func2:Function)
        where elementId(func1) = $id or elementId(func2) = $id
        return func1, func2, rel
    `,
        { id });

    const nodes: FunctionDataResult = {};
    functionCallsResult.records.forEach(rec => {
        const func1 = getFunctionData(rec.get('func1')) as FunctionData;
        nodes[func1.id] = func1;

        const func2 = getFunctionData(rec.get('func2')) as FunctionData;
        nodes[func2.id] = func2;
    });
    const links = functionCallsResult.records.map(rec => getRelationData(rec.get('rel') as Relationship));

    return reply.send({ info: functionData, nodes, links });
})

setupDB()
    .then(() => {
        fastify.listen({ port: SERVICE_PORT });
    })
    .catch(err => {
        fastify.log.error(err)
        process.exit(1);
    })
