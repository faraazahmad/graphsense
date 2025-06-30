import "dotenv/config";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

console.log(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
console.log(process.env.ANTHROPIC_API_KEY);

// Environment variable validation and type definitions
interface EnvironmentConfig {
  // Required variables
  HOME_PATH: string;
  ANTHROPIC_API_KEY: string;
  CO_API_KEY: string;

  // Optional variables with defaults
  NODE_ENV: string;
  PORT: number;
  LOG_LEVEL: string;
  NEO4J_URI: string;
  NEO4J_USERNAME: string;
  NEO4J_PASSWORD: string;
  INDEX_FROM_SCRATCH: boolean;
  DEBUG: string;
  CORS_ORIGIN: string;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW: number;
  HEALTH_CHECK_TIMEOUT: number;
}

// Validate required environment variables
function validateRequiredEnvVars(): void {
  const requiredVars = ["HOME", "ANTHROPIC_API_KEY", "CO_API_KEY"];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error("❌ Missing required environment variables:");
    missingVars.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error(
      "\n💡 Please check your .env file or environment configuration.",
    );
    console.error("You can use .env.template as a reference.");
    process.exit(1);
  }
}

// Helper function to parse boolean environment variables
function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

// Helper function to parse number environment variables
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Validate environment variables on module load
validateRequiredEnvVars();

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
export const CO_API_KEY = process.env.CO_API_KEY as string;

// Application configuration
export const NODE_ENV = process.env.NODE_ENV || "development";
export const SERVICE_PORT = parseNumber(process.env.PORT, 8080);
export const LOG_LEVEL = process.env.LOG_LEVEL || "info";
export const INDEX_FROM_SCRATCH = parseBoolean(
  process.env.INDEX_FROM_SCRATCH,
  false,
);

// Postgres configuration
export const POSTGRES_URL = process.env.POSTGRES_URL;

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

// Debug configuration
export const DEBUG = process.env.DEBUG || "";

// AI model instances
export const claude = anthropic("claude-3-5-sonnet-latest");
export const gemini = google("gemini-2.0-flash");

// Runtime environment information
export const ENV_INFO = {
  nodeEnv: NODE_ENV,
  port: SERVICE_PORT,
  logLevel: LOG_LEVEL,
  neo4jUri: NEO4J_URI,
  indexFromScratch: INDEX_FROM_SCRATCH,
  debug: DEBUG,
  timestamp: new Date().toISOString(),
} as const;

// Log environment information on startup
if (NODE_ENV === "development") {
  console.log("🔧 Environment Configuration:");
  console.log(`   Node Environment: ${NODE_ENV}`);
  console.log(`   Service Port: ${SERVICE_PORT}`);
  console.log(`   Log Level: ${LOG_LEVEL}`);
  console.log(`   Neo4j URI: ${NEO4J_URI}`);
  console.log(`   Index from Scratch: ${INDEX_FROM_SCRATCH}`);
  console.log(`   Debug: ${DEBUG || "(none)"}`);
  console.log("");
}
