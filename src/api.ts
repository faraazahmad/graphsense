// Import the framework and instantiate it
import Fastify from 'fastify'
import { ollama } from 'ollama-ai-provider';
import fastifyCors from '@fastify/cors';
import { pgClient, setupDB } from './db';

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
    const result = await pgClient.query(`SELECT id, name FROM functions ORDER BY embedding <-> '${JSON.stringify(embeddings[0])}' LIMIT 7;`)

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

interface FunctionRouteParams {
    id: string
}
fastify.get<{ Params: FunctionRouteParams }>('/functions/:id', async (request, reply) => {
    const { id } = request.params;
    // console.log(id);

    const result = await pgClient.query(`select id, name, code, summary from functions where id = $1 limit 1`, [id]);

    // console.log(result.rows);
    return reply.send(result.rows[0]);
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
