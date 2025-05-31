import "dotenv/config";
import neo4j, { Driver } from "neo4j-driver";
import { Pinecone } from "@pinecone-database/pinecone";
import { Client } from "pg";
import {
  getRepoQualifier,
  INDEX_FROM_SCRATCH,
  NEON_API_KEY,
  REPO_PATH,
  REPO_URI,
} from "./env";
import { NeonToolkit } from "@neondatabase/toolkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const pc = new Pinecone({
  apiKey: process.env["PINECONE_API_KEY"] as string,
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

const toolkit = new NeonToolkit(NEON_API_KEY);

export async function setupDB(defaultBranch: string, from_scratch: boolean = false) {
  db.graph.client = neo4j.driver("bolt://localhost:7687");

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

  // const projectName = getRepoQualifier(REPO_URI);
  // const listProjectResponse = await toolkit.apiClient.listProjects({
  //   search: projectName,
  // });

  // if (listProjectResponse.data.projects.length === 1) {
  //   db.relational.projectId = listProjectResponse.data.projects[0].id;
  // } else {
  //   const createProjectResponse = await toolkit.apiClient.createProject({
  //     project: {
  //       name: projectName,
  //       branch: {
  //         name: defaultBranch,
  //         database_name: defaultBranch,
  //         role_name: "owner",
  //       },
  //     },
  //   });
  //   db.relational.projectId = createProjectResponse.data.project.id;
  // }

  // const connURIResponse = await toolkit.apiClient.getConnectionUri({
  //   database_name: defaultBranch,
  //   projectId: db.relational.projectId,
  //   role_name: "owner",
  // });
  // db.relational.client = new Client(connURIResponse.data.uri);
  db.relational.client = new Client(
    "http://user:password@localhost:5432/admin-api",
  );
  db.relational.client!.connect();

  if (INDEX_FROM_SCRATCH) {
    console.log("Indexing from scratch");

    console.log("Deleting all nodes from Neo4j");
    await executeQuery(`MATCH (n) DETACH DELETE n;`, {});

    console.log("Dropping functions table from pg");
    await db.relational.client!.query("drop table if exists functions;");
  }

  const pgSchema = readFileSync(
    resolve(`${__dirname}/../db/schema.sql`),
  ).toString();
  const result = await db.relational.client!.query(pgSchema);

  return Promise.resolve(result.rows);
}

if (require.main === module) {
  setupDB("main")
    .then((res) => console.log(res))
    .catch((err) => console.error(err));
}
