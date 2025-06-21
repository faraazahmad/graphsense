#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const PROCESSES = {
  API: 'api',
  WATCHER: 'watcher',
  MCP: 'mcp'
};

const REPO_PATH = process.env.LOCAL_REPO_PATH || '/home/repo';
const BUILD_DIR = path.join(__dirname, 'build');

// Process tracking
const runningProcesses = new Map();
let isShuttingDown = false;

// Logging utilities
function log(message, process = 'MAIN') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${process}] ${message}`);
}

function logError(message, process = 'MAIN') {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${process}] ERROR: ${message}`);
}

// Check if build directory exists
function checkBuildDirectory() {
  if (!fs.existsSync(BUILD_DIR)) {
    logError('Build directory not found. Please run "npm run build" first.');
    process.exit(1);
  }
}

// Check if repository path exists
function checkRepositoryPath() {
  if (!fs.existsSync(REPO_PATH)) {
    logError(`Repository path does not exist: ${REPO_PATH}`);
    logError('Please ensure LOCAL_REPO_PATH environment variable points to a valid repository');
    process.exit(1);
  }
  log(`Using repository path: ${REPO_PATH}`);
}

// Build the TypeScript code
function buildProject() {
  return new Promise((resolve, reject) => {
    log('Building TypeScript project...');
    const buildProcess = spawn('npm', ['run', 'build'], {
      stdio: 'inherit',
      cwd: __dirname
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        log('Build completed successfully');
        resolve();
      } else {
        logError(`Build failed with code ${code}`);
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}

// Run initial indexing
function runInitialIndexing() {
  return new Promise((resolve, reject) => {
    log('Starting initial repository indexing...');
    const indexProcess = spawn('node', [path.join(BUILD_DIR, 'index.js'), REPO_PATH], {
      stdio: 'inherit',
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: 'production' }
    });

    indexProcess.on('close', (code) => {
      if (code === 0) {
        log('Initial indexing completed successfully');
        resolve();
      } else {
        logError(`Initial indexing failed with code ${code}`);
        reject(new Error(`Initial indexing failed with code ${code}`));
      }
    });

    indexProcess.on('error', (error) => {
      logError(`Failed to start indexing process: ${error.message}`);
      reject(error);
    });
  });
}

// Start a process and track it
function startProcess(name, command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    log(`Starting ${name}...`, name);

    const defaultOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: 'production' }
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
      childProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          log(output, name);
        }
      });
    }

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logError(output, name);
        }
      });
    }

    // Handle process events
    childProcess.on('close', (code, signal) => {
      runningProcesses.delete(name);
      if (!isShuttingDown) {
        if (code === 0) {
          log(`${name} exited normally`, name);
        } else {
          logError(`${name} exited with code ${code} and signal ${signal}`, name);
        }
      }
    });

    childProcess.on('error', (error) => {
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

// Start API server
async function startApiServer() {
  return startProcess(
    PROCESSES.API,
    'node',
    [path.join(BUILD_DIR, 'api.js')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: process.env.PORT || '8080'
      }
    }
  );
}

// Start file watcher
async function startWatcher() {
  return startProcess(
    PROCESSES.WATCHER,
    'node',
    [path.join(BUILD_DIR, 'watcher.js'), REPO_PATH]
  );
}

// Start MCP server
async function startMcpServer() {
  return startProcess(
    PROCESSES.MCP,
    'node',
    [path.join(BUILD_DIR, 'mcp.js')],
    {
      stdio: ['pipe', 'inherit', 'inherit'] // MCP uses stdio for communication
    }
  );
}

// Graceful shutdown
function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  log(`Received ${signal}, initiating graceful shutdown...`);

  const shutdownPromises = [];

  for (const [name, process] of runningProcesses) {
    log(`Stopping ${name}...`, name);
    shutdownPromises.push(new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError(`Force killing ${name} after timeout`, name);
        process.kill('SIGKILL');
        resolve();
      }, 10000); // 10 second timeout

      process.on('close', () => {
        clearTimeout(timeout);
        log(`${name} stopped`, name);
        resolve();
      });

      process.kill('SIGTERM');
    }));
  }

  Promise.all(shutdownPromises).then(() => {
    log('All processes stopped. Exiting...');
    process.exit(0);
  }).catch((error) => {
    logError(`Error during shutdown: ${error.message}`);
    process.exit(1);
  });
}

// Health check function
function performHealthCheck() {
  const healthCheckInterval = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(healthCheckInterval);
      return;
    }

    // Check if all expected processes are running
    const expectedProcesses = [PROCESSES.API, PROCESSES.WATCHER];
    const runningProcessNames = Array.from(runningProcesses.keys());

    for (const expectedProcess of expectedProcesses) {
      if (!runningProcessNames.includes(expectedProcess)) {
        logError(`Process ${expectedProcess} is not running!`);
      }
    }
  }, 30000); // Check every 30 seconds
}

// Main function
async function main() {
  try {
    log('Starting GraphSense Code Analysis Platform...');

    // Pre-flight checks
    checkBuildDirectory();
    checkRepositoryPath();

    // Build project
    await buildProject();

    // Run initial indexing
    await runInitialIndexing();

    // Start all services
    log('Starting all services...');

    // Start API server first (it's the main service)
    await startApiServer();

    // Wait a bit for API server to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Start file watcher
    await startWatcher();

    // Start MCP server
    await startMcpServer();

    log('All services started successfully!');
    log('GraphSense is ready to use:');
    log(`  - API Server: http://localhost:${process.env.PORT || 8080}`);
    log(`  - Health Check: http://localhost:${process.env.PORT || 8080}/health`);
    log(`  - File Watcher: Monitoring ${REPO_PATH}`);
    log(`  - MCP Server: Running on stdio`);

    // Start health monitoring
    performHealthCheck();

  } catch (error) {
    logError(`Failed to start services: ${error.message}`);
    gracefulShutdown('ERROR');
  }
}

// Handle signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError(`Uncaught exception: ${error.message}`);
  logError(error.stack);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the application
if (require.main === module) {
  main();
}

module.exports = {
  main,
  startProcess,
  gracefulShutdown
};
