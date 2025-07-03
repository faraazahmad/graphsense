import "dotenv/config";
import neo4j, { Driver } from "neo4j-driver";
import { Client } from "pg";
import { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, POSTGRES_URL } from "./env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export async function executeQuery(query: string, variables: Object) {
  const session = db.graph.client!.session();
  const result = await session.run(query, variables);
  await session.close();

  return Promise.resolve(result);
}

interface DBData {
  relational: {
    client?: Client;
  };
  graph: {
    client?: Driver;
  };
}
export const db: DBData = {
  relational: {
    client: undefined,
  },
  graph: {
    client: undefined,
  },
};

export async function setupDB() {
  try {
    const auth = NEO4J_PASSWORD
      ? neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
      : undefined;

    db.graph.client = neo4j.driver(NEO4J_URI, auth);

    // Create neo4j constraints
    await executeQuery(
      `
      CREATE CONSTRAINT file_path_unique IF NOT EXISTS
      FOR (f:File)
      REQUIRE f.path IS UNIQUE
    `,
      {},
    );
    await executeQuery(
      `
      CREATE CONSTRAINT function_name_path_unique IF NOT EXISTS
      FOR (f:Function)
      REQUIRE (f.name, f.path) IS UNIQUE
    `,
      {},
    );

    const connectionString = POSTGRES_URL;
    db.relational.client = new Client(connectionString);
    await db.relational.client.connect();

    // Test the connection
    await db.relational.client.query("SELECT 1");
    console.log("PostgreSQL connection established successfully");

    // Create pgvector extension
    await db.relational.client.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("pgvector extension ensured");

    // Apply schema
    const pgSchema = readFileSync(
      resolve(`${__dirname}/../db/schema.sql`),
    ).toString();

    const result = await db.relational.client.query(pgSchema);
    console.log("Database schema applied successfully");

    return Promise.resolve(result.rows);
  } catch (error) {
    console.log("Failed to setup database(s).");
    console.error(error);
    return Promise.reject(error);
  }
}

if (require.main === module) {
  setupDB()
    .then((res) => console.log(res))
    .catch((err) => console.error(err));
}
