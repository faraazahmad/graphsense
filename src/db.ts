import 'dotenv/config';
import neo4j, { Driver } from 'neo4j-driver';
import { Pinecone } from '@pinecone-database/pinecone';
import { Client } from 'pg';
import { REPO_PATH } from './env';
import { readFileSync } from 'fs';

export const pc = new Pinecone({
  apiKey: process.env['PINECONE_API_KEY'] as string
});

const index = pc.index('llama-text-embed-v2-index');
export const vectorNamespace = index.namespace(REPO_PATH);

// Create a driver instance
export let driver: Driver;

export async function executeQuery(query: string, variables: Object) {
    // console.log(query)
    const session = driver.session();
    const result = await session.run(query, variables);
    await session.close();

    return Promise.resolve(result);
}

export const pgClient = new Client({
    user: 'user',
    password: 'password',
    database: 'postgres',
    port: 5432
});

export async function setupDB() {
    driver = neo4j.driver('bolt://localhost:7687');

    // Create neo4j constraints
    await executeQuery(`
        CREATE CONSTRAINT file_path_unique IF NOT EXISTS
        FOR (f:File)
        REQUIRE f.path IS UNIQUE
    `, {});

    await executeQuery(`
        CREATE CONSTRAINT function_name_path_unique IF NOT EXISTS
        FOR (f:Function)
        REQUIRE (f.name, f.path) IS UNIQUE
    `, {});

    await pgClient.connect();
    const psqlSetupQuery = readFileSync(`${__dirname}/../db/schema.sql`).toString();
    await pgClient.query(psqlSetupQuery);

    return Promise.resolve();
}
