// Import the framework and instantiate it
import Fastify from 'fastify'
import { Client } from 'pg';
import { ollama } from 'ollama-ai-provider';
import fastifyCors from '@fastify/cors';
import { executeQuery } from './db';

const pgClient = new Client({
    user: 'user',
    password: 'password',
    database: 'postgres',
    port: 5432
});

pgClient.connect()
    .then(() => console.log('Connected to Postgres'))
    .catch((err) => `Error connecting to Postgres: ${err}`);

const embeddingModel = ollama('nomic-embed-text');

async function getSimilarFunctions(description: string) {
    const model = ollama.embedding(embeddingModel.modelId);
    const { embeddings } = await model.doEmbed({
        values: [description]
    });
    const result = await pgClient.query(`SELECT id, name FROM functions ORDER BY embedding <-> '${JSON.stringify(embeddings[0])}' LIMIT 5;`)

    return Promise.resolve(result.rows);
}

const fastify = Fastify({
    logger: true
})
fastify.register(fastifyCors, {
    origin: "*"
})

interface SearchQuery {
    description: string
}
fastify.get<{ Querystring: SearchQuery }>('/functions/search', async function handler(request, reply) {
    const { description } = request.query;

    const decodedDescription = decodeURI(description);
    console.log(decodedDescription);
    const result = await getSimilarFunctions(decodedDescription);
    console.log(result)

    reply.send(result);
})

interface FunctionRouteParams {
    id: string
}
fastify.get<{ Params: FunctionRouteParams }>('/functions/:id', async (request, reply) => {
    const { id } = request.params;
    // console.log(id);

    const result = await pgClient.query(`select id, name, code, summary from functions where id = $1 limit 1`, [id]);

    // console.log(result.rows);
    reply.send(result.rows[0]);
})

// Run the server!
try {
    fastify.listen({ port: 3000 })
    pgClient.connect()
        .then(() => console.log('Connected to Postgres'))
        .catch((err) => `Error connecting to Postgres: ${err}`);
} catch (err) {
    fastify.log.error(err)
    process.exit(1)
}
