import "dotenv/config";
import neo4j, { Driver } from "neo4j-driver";
import { Pinecone } from "@pinecone-database/pinecone";
import { Client } from "pg";
import {
  getRepoQualifier,
  NEON_API_KEY,
  REPO_PATH,
  REPO_URI,
  PINECONE_API_KEY,
  NEO4J_URI,
  NEO4J_USERNAME,
  NEO4J_PASSWORD,
} from "./env";
import { NeonToolkit } from "@neondatabase/toolkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const pc = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

const index = pc.index("llama-text-embed-v2-index");
export const vectorNamespace = index.namespace(REPO_PATH);

// Create a driver instance
export let driver: Driver;

export async function executeQuery(query: string, variables: Object) {
  const session = db.graph.client!.session();
  const result = await session.run(query, variables);
  await session.close();

  return Promise.resolve(result);
}

interface DBData {
  relational: {
    projectId: string;
    client?: Client;
  };
  graph: {
    client?: Driver;
  };
}
export const db: DBData = {
  relational: {
    projectId: "",
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

  const toolkit = new NeonToolkit(NEON_API_KEY);

  const projectName = getRepoQualifier(REPO_URI);
  const listProjectResponse = await toolkit.apiClient.listProjects({
    search: projectName,
  });

  if (listProjectResponse.data.projects.length === 1) {
    db.relational.projectId = listProjectResponse.data.projects[0].id;
  } else {
    const createProjectResponse = await toolkit.apiClient.createProject({
      project: {
        name: projectName,
        branch: {
          name: defaultBranch,
          database_name: defaultBranch,
          role_name: "owner",
        },
      },
    });
    db.relational.projectId = createProjectResponse.data.project.id;
  }

  const connURIResponse = await toolkit.apiClient.getConnectionUri({
    database_name: defaultBranch,
    projectId: db.relational.projectId,
    role_name: "owner",
  });
  db.relational.client = new Client(connURIResponse.data.uri);

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
