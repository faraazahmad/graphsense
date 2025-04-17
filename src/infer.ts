import { ollama } from 'ollama-ai-provider';
import { Client } from 'pg';
import { argv } from 'node:process';

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
    const {embeddings} = await model.doEmbed({
        values: [description]
    });
    const result = await pgClient.query(`SELECT name FROM functions ORDER BY embedding <-> '${JSON.stringify(embeddings[0])}' LIMIT 5;`)

    return  Promise.resolve(result.rows);
}

getSimilarFunctions(argv[2])
.then(rows => {
    console.log(`Found ${rows.length} functions:`);
    console.log(rows.map(row => row.name));
    pgClient.end();
});
