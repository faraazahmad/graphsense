#!/usr/bin/env node

const { Client } = require("pg");
require("dotenv/config");

async function testPostgreSQLConnection() {
  console.log("🔍 Testing PostgreSQL connection...\n");

  // Build connection string (same logic as db.ts)
  const connectionString =
    process.env.POSTGRES_URL ||
    `postgresql://${process.env.POSTGRES_USER || "postgres"}:${process.env.POSTGRES_PASSWORD || "postgres"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "graphsense"}`;

  console.log(`📍 Connection string: ${connectionString.replace(/:[^@]*@/, ':***@')}`);

  const client = new Client(connectionString);

  try {
    // Test connection
    console.log("🔌 Connecting to PostgreSQL...");
    await client.connect();
    console.log("✅ PostgreSQL connection established");

    // Test basic query
    console.log("🔍 Testing basic query...");
    const result = await client.query("SELECT version()");
    console.log(`✅ PostgreSQL version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);

    // Test pgvector extension
    console.log("🧩 Checking pgvector extension...");
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      console.log("✅ pgvector extension is available");

      // Test vector functionality
      await client.query("SELECT '[1,2,3]'::vector");
      console.log("✅ Vector data type is working");
    } catch (vectorError) {
      console.log("❌ pgvector extension failed:", vectorError.message);
      console.log("💡 Make sure you're using the pgvector/pgvector Docker image");
    }

    // Test table creation
    console.log("📋 Testing table creation...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        test_vector VECTOR(3),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Table creation successful");

    // Test vector insert/select
    console.log("💾 Testing vector operations...");
    await client.query(`
      INSERT INTO test_table (test_vector)
      VALUES ('[1,2,3]'::vector)
      ON CONFLICT DO NOTHING
    `);

    const vectorResult = await client.query("SELECT test_vector FROM test_table LIMIT 1");
    if (vectorResult.rows.length > 0) {
      console.log(`✅ Vector insert/select successful: ${vectorResult.rows[0].test_vector}`);
    }

    // Cleanup test table
    await client.query("DROP TABLE IF EXISTS test_table");
    console.log("🧹 Cleaned up test table");

    console.log("\n🎉 All PostgreSQL tests passed!");

  } catch (error) {
    console.error("\n❌ PostgreSQL connection test failed:");
    console.error(`   Error: ${error.message}`);

    if (error.code === 'ECONNREFUSED') {
      console.error("\n💡 Troubleshooting tips:");
      console.error("   • Make sure PostgreSQL is running");
      console.error("   • Check connection details in .env file");
      console.error("   • For Docker: run 'npm run docker:start'");
      console.error("   • For local: ensure PostgreSQL service is started");
    } else if (error.code === '28P01') {
      console.error("\n💡 Authentication failed:");
      console.error("   • Check POSTGRES_USER and POSTGRES_PASSWORD in .env");
    } else if (error.code === '3D000') {
      console.error("\n💡 Database does not exist:");
      console.error("   • Check POSTGRES_DB in .env");
      console.error("   • Create the database manually if needed");
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

async function testNeo4jConnection() {
  console.log("\n🔍 Testing Neo4j connection...");

  try {
    const neo4j = require("neo4j-driver");

    const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687";
    const NEO4J_USERNAME = process.env.NEO4J_USERNAME || "neo4j";
    const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "";

    console.log(`📍 Neo4j URI: ${NEO4J_URI}`);

    const auth = NEO4J_PASSWORD
      ? neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
      : undefined;

    const driver = neo4j.driver(NEO4J_URI, auth);
    const session = driver.session();

    const result = await session.run("RETURN 1 as test");
    console.log("✅ Neo4j connection successful");

    await session.close();
    await driver.close();

  } catch (error) {
    console.error("❌ Neo4j connection failed:", error.message);
    console.error("\n💡 Troubleshooting tips:");
    console.error("   • Make sure Neo4j is running");
    console.error("   • For Docker: run 'npm run docker:start'");
    console.error("   • Check NEO4J_URI in .env file");
  }
}

async function main() {
  console.log("🧪 Database Connection Test\n");
  console.log("=" .repeat(50));

  await testPostgreSQLConnection();
  await testNeo4jConnection();

  console.log("\n" + "=".repeat(50));
  console.log("🏁 Database connection test completed");
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testPostgreSQLConnection, testNeo4jConnection };
