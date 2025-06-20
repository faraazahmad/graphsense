import "dotenv/config";
import neo4j, { Driver } from "neo4j-driver";
import { Pinecone } from "@pinecone-database/pinecone";
import { Client } from "pg";
import {
  getRepoQualifier,
  REPO_PATH,
  REPO_URI,
  PINECONE_API_KEY,
  NEO4J_URI,
  NEO4J_USERNAME,
  NEO4J_PASSWORD,
} from "./env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const pc = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

const index = pc.index("llama-text-embed-v2-index");
export const vectorNamespace = index.namespace(REPO_PATH);

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

export async function setupDB(
  defaultBranch: string = "main",
  from_scratch: boolean = false,
) {
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

  // Connect to local PostgreSQL
  const connectionString =
    process.env.POSTGRES_URL ||
    `postgresql://${process.env.POSTGRES_USER || "postgres"}:${process.env.POSTGRES_PASSWORD || "postgres"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "graphsense"}`;

  db.relational.client = new Client(connectionString);
  db.relational.client!.connect();

  await db.relational.client!.query("CREATE EXTENSION IF NOT EXISTS vector");
  const pgSchema = readFileSync(
    resolve(`${__dirname}/../db/schema.sql`),
  ).toString();

  let result;
  try {
    result = await db.relational.client!.query(pgSchema);
  } catch (error) {
    console.log("there was an error");
    console.error(error);
  }
  console.log(result);

  return Promise.resolve(result!.rows);
}

if (require.main === module) {
  setupDB()
    .then((res) => console.log(res))
    .catch((err) => console.error(err));
}
