// Mock environment variables for testing BEFORE importing env.ts
process.env.ANTHROPIC_API_KEY = "mock-key";
process.env.PINECONE_API_KEY = "mock-key";
process.env.NEO4J_URI = "bolt://localhost:7687";
process.env.POSTGRES_URL = "postgresql://postgres:password@localhost:5432/graphsense";

import { executeQuery, setupDB } from "./db";
import { parseFile } from "./index";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface TestResult {
  test: string;
  passed: boolean;
  details?: string;
}

// Setup test files for verification
async function setupTestFiles(): Promise<string> {
  const testDir = resolve("./test-files");
  
  try {
    mkdirSync(testDir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }

  // Create test file A that imports from B and calls functions
  const fileA = resolve(testDir, "fileA.ts");
  const contentA = `
import { helperFunction, anotherHelper } from "./fileB";
import { utilityFunction } from "./fileC";

export function mainFunction() {
  const result = helperFunction();
  const other = anotherHelper();
  return utilityFunction(result, other);
}

export function secondFunction() {
  return helperFunction();
}
`;

  // Create test file B with helper functions
  const fileB = resolve(testDir, "fileB.ts");
  const contentB = `
export function helperFunction() {
  return "helper";
}

export function anotherHelper() {
  return "another";
}
`;

  // Create test file C with utility function
  const fileC = resolve(testDir, "fileC.ts");
  const contentC = `
export function utilityFunction(a: string, b: string) {
  return a + b;
}
`;

  writeFileSync(fileA, contentA);
  writeFileSync(fileB, contentB);
  writeFileSync(fileC, contentC);

  return testDir;
}

async function runTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log("Setting up database...");
    await setupDB();
    
    console.log("Setting up test files...");
    const testDir = await setupTestFiles();
    
    console.log("Parsing test files...");
    // Parse the test files
    await parseFile(resolve(testDir, "fileA.ts"));
    await parseFile(resolve(testDir, "fileB.ts"));
    await parseFile(resolve(testDir, "fileC.ts"));

    // Wait a bit for processing to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 1: Check if File nodes are created
    console.log("Test 1: Checking File nodes...");
    const fileNodesResult = await executeQuery(
      `MATCH (f:File) WHERE f.path CONTAINS "test-files" RETURN count(f) as count`,
      {}
    );
    const fileCount = fileNodesResult.records[0]?.get("count").toNumber() || 0;
    results.push({
      test: "File nodes created",
      passed: fileCount >= 3,
      details: `Expected at least 3 file nodes, found ${fileCount}`
    });

    // Test 2: Check if IMPORTS_FROM relationships exist
    console.log("Test 2: Checking IMPORTS_FROM relationships...");
    const importsResult = await executeQuery(
      `MATCH (f1:File)-[r:IMPORTS_FROM]->(f2:File) 
       WHERE f1.path CONTAINS "test-files" AND f2.path CONTAINS "test-files"
       RETURN count(r) as count`,
      {}
    );
    const importsCount = importsResult.records[0]?.get("count").toNumber() || 0;
    results.push({
      test: "IMPORTS_FROM relationships created", 
      passed: importsCount >= 2,
      details: `Expected at least 2 import relationships, found ${importsCount}`
    });

    // Test 3: Check if Function nodes are created
    console.log("Test 3: Checking Function nodes...");
    const functionNodesResult = await executeQuery(
      `MATCH (f:Function) WHERE f.path CONTAINS "test-files" RETURN count(f) as count`,
      {}
    );
    const functionCount = functionNodesResult.records[0]?.get("count").toNumber() || 0;
    results.push({
      test: "Function nodes created",
      passed: functionCount >= 4,
      details: `Expected at least 4 function nodes, found ${functionCount}`
    });

    // Test 4: Check if CALLS relationships exist
    console.log("Test 4: Checking CALLS relationships...");
    const callsResult = await executeQuery(
      `MATCH (f1:Function)-[r:CALLS]->(f2:Function) 
       WHERE f1.path CONTAINS "test-files" AND f2.path CONTAINS "test-files"
       RETURN count(r) as count`,
      {}
    );
    const callsCount = callsResult.records[0]?.get("count").toNumber() || 0;
    results.push({
      test: "CALLS relationships created",
      passed: callsCount >= 1,
      details: `Expected at least 1 call relationship, found ${callsCount}`
    });

    // Test 5: Check specific import relationship details
    console.log("Test 5: Checking specific import details...");
    const specificImportResult = await executeQuery(
      `MATCH (f1:File)-[r:IMPORTS_FROM]->(f2:File) 
       WHERE f1.path CONTAINS "fileA" AND f2.path CONTAINS "fileB"
       RETURN r.clause as clause`,
      {}
    );
    const importClauses = specificImportResult.records.map(r => r.get("clause"));
    results.push({
      test: "Specific import clauses captured",
      passed: importClauses.includes("helperFunction") && importClauses.includes("anotherHelper"),
      details: `Import clauses found: ${importClauses.join(", ")}`
    });

    // Test 6: Check function-to-function call relationships
    console.log("Test 6: Checking function call relationships...");
    const functionCallResult = await executeQuery(
      `MATCH (caller:Function)-[r:CALLS]->(callee:Function)
       WHERE caller.path CONTAINS "test-files" AND callee.path CONTAINS "test-files"
       RETURN caller.name as caller_name, callee.name as callee_name`,
      {}
    );
    const callRelationships = functionCallResult.records.map(r => 
      `${r.get("caller_name")} -> ${r.get("callee_name")}`
    );
    results.push({
      test: "Function call relationships mapped",
      passed: callRelationships.length > 0,
      details: `Call relationships: ${callRelationships.join(", ")}`
    });

  } catch (error) {
    console.error("Test setup error:", error);
    results.push({
      test: "Test setup",
      passed: false,
      details: `Error: ${error}`
    });
  }

  return results;
}

async function printResults(results: TestResult[]): Promise<void> {
  console.log("\n=== Graph Relations Test Results ===");
  
  let passedCount = 0;
  for (const result of results) {
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} ${result.test}`);
    if (result.details) {
      console.log(`    ${result.details}`);
    }
    if (result.passed) passedCount++;
  }
  
  console.log(`\nOverall: ${passedCount}/${results.length} tests passed`);
  
  if (passedCount !== results.length) {
    console.log("\n⚠️  Some graph relations are not being created properly!");
  } else {
    console.log("\n✅ All graph relations are working correctly!");
  }
}

// Run the tests
if (require.main === module) {
  runTests()
    .then(printResults)
    .catch(console.error);
}

export { runTests, printResults };
