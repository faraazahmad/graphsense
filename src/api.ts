// Import the framework and instantiate it
import Fastify from 'fastify'
import { ollama } from 'ollama-ai-provider';
import fastifyCors from '@fastify/cors';
import { executeQuery, pgClient, setupDB } from './db';
import { Node, Relationship } from 'neo4j-driver';

let fastify = Fastify({
    logger: true
});
fastify.register(fastifyCors, {
    origin: "*"
});

setupDB();

const embeddingModel = ollama('nomic-embed-text');

async function getSimilarFunctions(description: string) {
    const model = ollama.embedding(embeddingModel.modelId);
    const { embeddings } = await model.doEmbed({
        values: [description]
    });
    const result = await pgClient.query(`SELECT id, name FROM functions ORDER BY embedding <=> '${JSON.stringify(embeddings[0])}' LIMIT 7;`)

    return Promise.resolve(result.rows);
}

interface SearchQuery {
    description: string
}
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

interface FunctionRouteParams {
    id: string
}
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

// Run the server!
try {
    pgClient.connect()
        .then(() => console.log('Connected to Postgres'))
        .catch((err) => `Error connecting to Postgres: ${err}`);
    fastify.listen({ port: 3000 })
} catch (err) {
    fastify.log.error(err)
    process.exit(1)
}
