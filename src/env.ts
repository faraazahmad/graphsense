import { anthropic } from "@ai-sdk/anthropic";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as dotenv from "dotenv";

const envFile = path.join(os.homedir(), ".graphsense", ".env");

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
  console.log(`Loaded environment variables from ${envFile}`);
} else {
  console.log(
    `Environment file not found at ${envFile}, using system environment variables`,
  );
}

// Validate required environment variables
function validateRequiredEnvVars(): void {
  const requiredVars = ["HOME", "ANTHROPIC_API_KEY", "PINECONE_API_KEY"];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error("Missing required environment variables:");
    missingVars.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error(
      "\n Please check your .env file or environment configuration.",
    );
    process.exit(1);
  }
}

// Validate environment variables on module load
validateRequiredEnvVars();

// Helper function to parse number environment variables
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function getRepoQualifier(repoPath: string): string {
  // Extract repository name from the path
  const pathParts = repoPath.split("/").filter((part) => part.length > 0);
  const repoName = pathParts[pathParts.length - 1] || "default-repo";

  // Create a simple qualifier based on the repository directory name
  return `local/${repoName}`;
}

// Core environment variables
export const HOME_PATH = process.env.HOME as string;
export const REPO_PATH = "/home/repo";

// API Keys
export const PINECONE_API_KEY = process.env.PINECONE_API_KEY as string;

// Application configuration
export const NODE_ENV = process.env.NODE_ENV || "development";
export const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// Postgres configuration
export const POSTGRES_URL =
  process.env.POSTGRES_URL ||
  "postgresql://postgres:postgres@localhost:5432/graphsense";

// Neo4j configuration
export const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687";
export const NEO4J_USERNAME = process.env.NEO4J_USERNAME || "neo4j";
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "";

// Security and performance configuration
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
export const RATE_LIMIT_MAX = parseNumber(process.env.RATE_LIMIT_MAX, 100);
export const RATE_LIMIT_WINDOW = parseNumber(
  process.env.RATE_LIMIT_WINDOW,
  900000,
); // 15 minutes
export const HEALTH_CHECK_TIMEOUT = parseNumber(
  process.env.HEALTH_CHECK_TIMEOUT,
  5000,
);

// AI model instances
export const claude = anthropic("claude-4-opus-20250514");
