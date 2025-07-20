// Mock environment variables for testing BEFORE importing env.ts
process.env.ANTHROPIC_API_KEY = "mock-key";
process.env.PINECONE_API_KEY = "mock-key";
process.env.NEO4J_URI = "bolt://localhost:7687";
process.env.POSTGRES_URL = "postgresql://postgres:password@localhost:5432/graphsense";

import { executeQuery, setupDB } from "./db";

async function simpleTest() {
  try {
    console.log("Setting up database...");
    await setupDB();
    
    console.log("Testing simple Neo4j query...");
    const result = await executeQuery("RETURN 'Hello Neo4j' as message", {});
    console.log("Neo4j response:", result.records[0]?.get("message"));
    
    console.log("✅ Database connection successful!");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
  }
}

if (require.main === module) {
  simpleTest().catch(console.error);
}
