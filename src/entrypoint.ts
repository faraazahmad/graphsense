#!/usr/bin/env node

import { spawn, exec, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as os from "os";
import { promisify } from "util";
import getPort from "get-port";
import * as dotenv from "dotenv";

const execAsync = promisify(exec);

// Load environment variables from ~/.graphsense/.env
const graphsenseDir = path.join(os.homedir(), ".graphsense");
const envFile = path.join(graphsenseDir, ".env");

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
  console.log(`Loaded environment variables from ${envFile}`);
} else {
  console.log(
    `Environment file not found at ${envFile}, using system environment variables`,
  );
}

// Configuration
interface ProcessInfo {
  name: string;
  pid?: number;
  process?: ChildProcess;
}

const PROCESSES = {
  WATCHER: "watcher",
  MCP: "mcp",
  INDEXING: "indexing",
} as const;

// Get repo path from command line arguments
const repoArg = process.argv[2];
if (!repoArg) {
  console.error("Error: Repository path is required as first argument");
  console.error("Usage: node entrypoint.ts <repo-path>");
  process.exit(1);
}
const REPO_PATH = path.resolve(repoArg);
const BUILD_DIR = path.join(__dirname);

// Process tracking
const runningProcesses = new Map<string, ChildProcess>();
const runningContainers = new Set<string>();
let isShuttingDown = false;

// Docker container info
interface ContainerInfo {
  name: string;
  ports: { host: number; container: number }[];
  running: boolean;
}

// Logging utilities
function log(message: string, process = "MAIN"): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${process}] ${message}`);
}

function logError(message: string, process = "MAIN"): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${process}] ERROR: ${message}`);
}

// Create SHA hash of repository path
function createRepoHash(repoPath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(repoPath);
  return hash.digest("hex").substring(0, 16);
}

// Check if port is in use
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`netstat -tuln | grep :${port}`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// Find available ports
async function findAvailablePorts(preferredPorts: number[]): Promise<number[]> {
  const availablePorts: number[] = [];

  for (const port of preferredPorts) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      availablePorts.push(port);
    } else {
      // Find alternative port
      const alternativePort = await getPort({ port: port + 1000 });
      availablePorts.push(alternativePort);
      log(`Port ${port} is in use, using ${alternativePort} instead`);
    }
  }

  return availablePorts;
}

// Check if docker container exists and is running
async function getContainerInfo(
  containerName: string,
): Promise<ContainerInfo | null> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter name=${containerName} --format "{{.Names}},{{.Status}},{{.Ports}}"`,
    );

    if (!stdout.trim()) {
      return null;
    }

    const [name, status, portsStr] = stdout.trim().split(",");
    const running = status.includes("Up");
    const ports: { host: number; container: number }[] = [];

    // Parse port mappings like "0.0.0.0:5432->5432/tcp"
    if (portsStr) {
      const portMatches = portsStr.match(/0\.0\.0\.0:(\d+)->(\d+)/g);
      if (portMatches) {
        for (const match of portMatches) {
          const [hostPort, containerPort] = match
            .split("->")[0]
            .split(":")[1]
            .split("-");
          ports.push({
            host: parseInt(hostPort),
            container: parseInt(containerPort.split("/")[0]),
          });
        }
      }
    }

    return { name, running, ports };
  } catch {
    return null;
  }
}

// Start or get existing postgres container
async function setupPostgresContainer(
  repoHash: string,
): Promise<{ host: number; container: number }> {
  const containerName = `graphsense-postgres-${repoHash}`;
  const preferredPort = 5432;

  const existingContainer = await getContainerInfo(containerName);

  if (existingContainer?.running) {
    const pgPort = existingContainer.ports.find((p) => p.container === 5432);
    if (pgPort) {
      log(`Using existing postgres container on port ${pgPort.host}`);
      return pgPort;
    }
  }

  // Find available port
  const [hostPort] = await findAvailablePorts([preferredPort]);

  if (existingContainer && !existingContainer.running) {
    log(`Starting existing postgres container ${containerName}...`);
    await execAsync(`docker start ${containerName}`);
  } else {
    log(
      `Creating new postgres container ${containerName} on port ${hostPort}...`,
    );
    const postgresPassword = process.env.POSTGRES_PASSWORD || "postgres";

    await execAsync(`docker run -d \\
      --name ${containerName} \\
      --restart unless-stopped \\
      -p ${hostPort}:5432 \\
      -v graphsense_postgres_data_${repoHash}:/var/lib/postgresql/data \\
      -e POSTGRES_DB=graphsense \\
      -e POSTGRES_USER=postgres \\
      -e POSTGRES_PASSWORD=${postgresPassword} \\
      pgvector/pgvector:pg17`);
  }

  // Track container for cleanup
  runningContainers.add(containerName);

  // Wait for postgres to be ready
  log("Waiting for postgres to be ready...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  return { host: hostPort, container: 5432 };
}

// Start or get existing neo4j container
async function setupNeo4jContainer(
  repoHash: string,
): Promise<{ host: number; container: number }> {
  const containerName = `graphsense-neo4j-${repoHash}`;
  const preferredPort = 7687;

  const existingContainer = await getContainerInfo(containerName);

  if (existingContainer?.running) {
    const neo4jPort = existingContainer.ports.find((p) => p.container === 7687);
    if (neo4jPort) {
      log(`Using existing neo4j container on port ${neo4jPort.host}`);
      return neo4jPort;
    }
  }

  // Find available port
  const [hostPort] = await findAvailablePorts([preferredPort]);

  if (existingContainer && !existingContainer.running) {
    log(`Starting existing neo4j container ${containerName}...`);
    await execAsync(`docker start ${containerName}`);
  } else {
    log(`Creating new neo4j container ${containerName} on port ${hostPort}...`);
    const neo4jAuth = process.env.NEO4J_AUTH || "none";

    await execAsync(`docker run -d \\
      --name ${containerName} \\
      --restart unless-stopped \\
      -p ${hostPort}:7687 \\
      -p ${hostPort + 1000}:7474 \\
      -v graphsense_neo4j_data_${repoHash}:/data \\
      -v graphsense_neo4j_logs_${repoHash}:/logs \\
      -v graphsense_neo4j_plugins_${repoHash}:/plugins \\
      -v graphsense_neo4j_conf_${repoHash}:/conf \\
      -e NEO4J_AUTH=${neo4jAuth} \\
      -e NEO4J_apoc_export_file_enabled=true \\
      -e NEO4J_apoc_import_file_enabled=true \\
      -e NEO4J_apoc_import_file_use__neo4j__config=true \\
      -e NEO4J_PLUGINS=apoc \\
      neo4j:latest`);
  }

  // Track container for cleanup
  runningContainers.add(containerName);

  // Wait for neo4j to be ready
  log("Waiting for neo4j to be ready...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  return { host: hostPort, container: 7687 };
}

// Check if repository path exists
function checkRepositoryPath(): void {
  if (!fs.existsSync(REPO_PATH)) {
    logError(`Repository path does not exist: ${REPO_PATH}`);
    logError("Please provide a valid repository path as the first argument");
    process.exit(1);
  }
  log(`Using repository path: ${REPO_PATH}`);
}

// Start a process and track it
function startProcess(
  name: string,
  command: string,
  args: string[] = [],
  options: any = {},
): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    log(`Starting ${name}...`, name);

    const defaultOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: "production" },
    };

    const mergedOptions = { ...defaultOptions, ...options };
    const childProcess = spawn(command, args, mergedOptions);

    if (!childProcess || !childProcess.pid) {
      logError(`Failed to start ${name}`, name);
      reject(new Error(`Failed to start ${name}`));
      return;
    }

    runningProcesses.set(name, childProcess);

    // Handle stdout
    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          log(output, name);
        }
      });
    }

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          logError(output, name);
        }
      });
    }

    // Handle process events
    childProcess.on("close", (code, signal) => {
      runningProcesses.delete(name);
      if (!isShuttingDown) {
        if (code === 0) {
          log(`${name} exited normally`, name);
        } else {
          logError(
            `${name} exited with code ${code} and signal ${signal}`,
            name,
          );
        }
      }
    });

    childProcess.on("error", (error) => {
      logError(`${name} process error: ${error.message}`, name);
      runningProcesses.delete(name);
      if (!isShuttingDown) {
        reject(error);
      }
    });

    // Give process time to start
    setTimeout(() => {
      if (runningProcesses.has(name)) {
        log(`${name} started successfully with PID ${childProcess.pid}`, name);
        resolve(childProcess);
      }
    }, 2000);
  });
}

// Run initial indexing as child process
function startInitialIndexing(pgPort: number, neo4jPort: number): void {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    POSTGRES_URL: `postgresql://postgres:postgres@localhost:${pgPort}/graphsense`,
    NEO4J_URI: `bolt://localhost:${neo4jPort}`,
  };

  startProcess(
    PROCESSES.INDEXING,
    "node",
    [path.join(__dirname, "index.js"), REPO_PATH],
    { env },
  ).catch((error) => {
    logError(`Failed to start indexing: ${error.message}`);
  });
}

// Start file watcher as child process
function startWatcher(pgPort: number, neo4jPort: number): void {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    POSTGRES_URL: `postgresql://postgres:postgres@localhost:${pgPort}/graphsense`,
    NEO4J_URI: `bolt://localhost:${neo4jPort}`,
  };

  startProcess(
    PROCESSES.WATCHER,
    "node",
    [path.join(__dirname, "watcher.js"), REPO_PATH],
    { env },
  ).catch((error) => {
    logError(`Failed to start watcher: ${error.message}`);
  });
}

// Start MCP HTTP server as child process
function startMcpServer(pgPort: number, neo4jPort: number): void {
  const env = {
    ...process.env,
    POSTGRES_URL: `postgresql://postgres:postgres@localhost:${pgPort}/graphsense`,
    NEO4J_URI: `bolt://localhost:${neo4jPort}`,
  };

  startProcess(PROCESSES.MCP, "node", [path.join(__dirname, "mcp.js")], {
    stdio: "inherit",
    env,
  }).catch((error) => {
    logError(`Failed to start MCP server: ${error.message}`);
  });
}

// Stop all tracked containers
async function stopContainers(): Promise<void> {
  if (runningContainers.size === 0) {
    return;
  }

  log("Stopping Docker containers...");
  const containerStopPromises: Promise<void>[] = [];

  for (const containerName of runningContainers) {
    log(`Stopping container ${containerName}...`);
    containerStopPromises.push(
      execAsync(`docker stop ${containerName}`)
        .then(() => log(`Container ${containerName} stopped`))
        .catch((error) =>
          logError(
            `Failed to stop container ${containerName}: ${error.message}`,
          ),
        ),
    );
  }

  await Promise.all(containerStopPromises);
  runningContainers.clear();
}

// Graceful shutdown
function gracefulShutdown(signal: string): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  log(`Received ${signal}, initiating graceful shutdown...`);

  // First stop all child processes
  const shutdownPromises: Promise<void>[] = [];

  for (const [name, process] of runningProcesses) {
    log(`Stopping ${name}...`, name);
    shutdownPromises.push(
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logError(`Force killing ${name} after timeout`, name);
          process.kill("SIGKILL");
          resolve();
        }, 10000); // 10 second timeout

        process.on("close", () => {
          clearTimeout(timeout);
          log(`${name} stopped`, name);
          resolve();
        });

        process.kill("SIGTERM");
      }),
    );
  }

  Promise.all(shutdownPromises)
    .then(async () => {
      log("All processes stopped.");
      // Now stop containers
      await stopContainers();
      log("All containers stopped. Exiting...");
      process.exit(0);
    })
    .catch((error) => {
      logError(`Error during shutdown: ${error.message}`);
      process.exit(1);
    });
}

// Health check function
function performHealthCheck(): void {
  const healthCheckInterval = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(healthCheckInterval);
      return;
    }

    // Check if all expected processes are running
    const expectedProcesses = [PROCESSES.WATCHER, PROCESSES.MCP];
    const runningProcessNames = Array.from(runningProcesses.keys());

    for (const expectedProcess of expectedProcesses) {
      if (!runningProcessNames.includes(expectedProcess)) {
        logError(`Process ${expectedProcess} is not running!`);
      }
    }
  }, 30000); // Check every 30 seconds
}

// Main function
async function main(): Promise<void> {
  try {
    log("Starting GraphSense...");

    // Pre-flight checks
    checkRepositoryPath();

    // Create repository hash
    const repoHash = createRepoHash(REPO_PATH);
    log(`Repository hash: ${repoHash}`);

    // Setup database containers
    log("Setting up database containers...");
    const [pgPorts, neo4jPorts] = await Promise.all([
      setupPostgresContainer(repoHash),
      setupNeo4jContainer(repoHash),
    ]);

    log(`Postgres available on port ${pgPorts.host}`);
    log(`Neo4j available on port ${neo4jPorts.host}`);

    // Start all services as child processes (non-blocking)
    log("Starting all services...");

    // Start initial indexing (non-blocking)
    startInitialIndexing(pgPorts.host, neo4jPorts.host);

    // Start file watcher (non-blocking)
    startWatcher(pgPorts.host, neo4jPorts.host);

    // Start MCP HTTP server (non-blocking)
    startMcpServer(pgPorts.host, neo4jPorts.host);

    log("All services started successfully!");
    log("GraphSense is ready to use:");
    log(`  - File Watcher: Monitoring ${REPO_PATH}`);
    log(`  - Postgres: localhost:${pgPorts.host}`);
    log(`  - Neo4j: bolt://localhost:${neo4jPorts.host}`);

    // Start health monitoring
    performHealthCheck();
  } catch (error) {
    logError(`Failed to start services: ${(error as Error).message}`);
    gracefulShutdown("ERROR");
  }
}

// Handle signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logError(`Uncaught exception: ${error.message}`);
  logError(error.stack || "");
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  logError(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  gracefulShutdown("UNHANDLED_REJECTION");
});

// Start the application
if (require.main === module) {
  main();
}

export { main, startProcess, gracefulShutdown };
