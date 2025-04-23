import neo4j from 'neo4j-driver';
import { Client } from 'pg';

// Create a driver instance
export const driver = neo4j.driver('bolt://localhost:7687');

export async function executeQuery(query: string, variables: Object) {
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

    await pgClient.connect()
        .then(() => console.log('Connected to Postgres'))
        .catch((err) => `Error connecting to Postgres: ${err}`);
}
