import "dotenv/config";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

// Environment variable validation and type definitions
interface EnvironmentConfig {
  // Required variables
  REPO_URI: string;
  HOME_PATH: string;
  NEON_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PINECONE_API_KEY: string;
  CO_API_KEY: string;

  // Optional variables with defaults
  GITHUB_PAT?: string;
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
  const requiredVars = [
    "REPO_URI",
    "HOME",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "ANTHROPIC_API_KEY",
    "PINECONE_API_KEY",
    "CO_API_KEY",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error("❌ Missing required environment variables:");
    missingVars.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error(
      "\n💡 Please check your .env file or environment configuration.",
    );
    console.error("   You can use .env.template as a reference.");
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

export function getRepoQualifier(repoUri: string) {
  const isHttpUrl =
    repoUri.startsWith("http://") || repoUri.startsWith("https://");
  const isSshUrl = repoUri.startsWith("git@");

  if (!isHttpUrl && !isSshUrl) {
    return "";
  }

  let org: string, repoName: string, cloneUrl: string;

  if (isHttpUrl) {
    cloneUrl = repoUri.replace("github", `faraazahmad:${GITHUB_PAT}@github`);
    const url = new URL(cloneUrl);
    const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
    org = pathParts[0];
    repoName = pathParts[1].replace(/^rs-/, "").replace(/\.git$/, "");
  } else {
    // SSH URL format: git@github.com:org/repo.git
    cloneUrl = repoUri;
    const colonIndex = repoUri.indexOf(":");
    const pathAfterColon = repoUri.substring(colonIndex + 1);
    const pathParts = pathAfterColon.split("/");
    org = pathParts[0];
    repoName = pathParts[1].replace(/^rs-/, "").replace(/\.git$/, "");
  }

  return `${org}/${repoName}`;
}

// Core environment variables
export const GITHUB_PAT = process.env.GITHUB_PAT;
export const NEON_API_KEY = process.env.NEON_API_KEY as string;
export const HOME_PATH = process.env.HOME as string;
export const REPO_URI = process.env.REPO_URI as string;
export const REPO_PATH = '/home/repo'; // `${HOME_PATH}/.graphsense/${getRepoQualifier(REPO_URI)}`;

// API Keys
export const GOOGLE_GENERATIVE_AI_API_KEY = process.env
  .GOOGLE_GENERATIVE_AI_API_KEY as string;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY as string;
export const PINECONE_API_KEY = process.env.PINECONE_API_KEY as string;
export const CO_API_KEY = process.env.CO_API_KEY as string;

// Application configuration
export const NODE_ENV = process.env.NODE_ENV || "development";
export const SERVICE_PORT = parseNumber(process.env.PORT, 8080);
export const LOG_LEVEL = process.env.LOG_LEVEL || "info";
export const INDEX_FROM_SCRATCH = parseBoolean(
  process.env.INDEX_FROM_SCRATCH,
  false,
);

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
export const gemini = google("gemini-2.0-flash-lite-preview-02-05");

// Runtime environment information
export const ENV_INFO = {
  nodeEnv: NODE_ENV,
  port: SERVICE_PORT,
  logLevel: LOG_LEVEL,
  repoUri: REPO_URI,
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
  console.log(`   Repository URI: ${REPO_URI}`);
  console.log(`   Neo4j URI: ${NEO4J_URI}`);
  console.log(`   Index from Scratch: ${INDEX_FROM_SCRATCH}`);
  console.log(`   Debug: ${DEBUG || "(none)"}`);
  console.log("");
}
