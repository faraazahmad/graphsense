#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const PROCESSES = {
  API: 'api',
  WATCHER: 'watcher',
  MCP: 'mcp'
};

const REPO_PATH = process.env.LOCAL_REPO_PATH || process.argv[2] || '/home/repo';
const BUILD_DIR = path.join(__dirname, 'build');

// Process tracking
const runningProcesses = new Map();
let isShuttingDown = false;

// Logging utilities
function log(message, process = 'DEV') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${process}] ${message}`);
}

function logError(message, process = 'DEV') {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${process}] ERROR: ${message}`);
}

// Check if repository path exists
function checkRepositoryPath() {
  if (!fs.existsSync(REPO_PATH)) {
    logError(`Repository path does not exist: ${REPO_PATH}`);
    logError('Usage: node entrypoint-dev.js <path-to-repo>');
    process.exit(1);
  }
  log(`Using repository path: ${REPO_PATH}`);
}

// Build the TypeScript code if needed
async function buildIfNeeded() {
  if (!fs.existsSync(BUILD_DIR)) {
    log('Build directory not found. Building...');
    return new Promise((resolve, reject) => {
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
  } else {
    log('Build directory exists, skipping build');
  }
}

// Start a process and track it
function startProcess(name, command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    log(`Starting ${name}...`, name);

    const defaultOptions = {
      stdio: 'inherit',
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: 'development' }
    };

    const mergedOptions = { ...defaultOptions, ...options };
    const childProcess = spawn(command, args, mergedOptions);

    if (!childProcess || !childProcess.pid) {
      logError(`Failed to start ${name}`, name);
      reject(new Error(`Failed to start ${name}`));
      return;
    }

    runningProcesses.set(name, childProcess);

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
    }, 1000);
  });
}

// Start API server
async function startApiServer() {
  return startProcess(
    PROCESSES.API,
    'node',
    [path.join(BUILD_DIR, 'api.js')],
    {
      env: {
        ...process.env,
        NODE_ENV: 'development',
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
  log(`Received ${signal}, shutting down...`);

  const shutdownPromises = [];

  for (const [name, process] of runningProcesses) {
    log(`Stopping ${name}...`, name);
    shutdownPromises.push(new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError(`Force killing ${name} after timeout`, name);
        process.kill('SIGKILL');
        resolve();
      }, 5000); // 5 second timeout for dev

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

// Main function
async function main() {
  try {
    log('Starting GraphSense in Development Mode...');

    // Pre-flight checks
    checkRepositoryPath();

    // Build if needed
    await buildIfNeeded();

    // Start services
    log('Starting development services...');

    // Start API server
    await startApiServer();

    // Wait a bit for API server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start file watcher
    await startWatcher();

    // Optionally start MCP server (comment out if not needed)
    // await startMcpServer();

    log('Development services started!');
    log('Available services:');
    log(`  - API Server: http://localhost:${process.env.PORT || 8080}`);
    log(`  - Health Check: http://localhost:${process.env.PORT || 8080}/health`);
    log(`  - File Watcher: Monitoring ${REPO_PATH}`);
    log('');
    log('To run initial indexing manually: npm start <repo-path>');
    log('Press Ctrl+C to stop all services');

  } catch (error) {
    logError(`Failed to start development services: ${error.message}`);
    process.exit(1);
  }
}

// Handle signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError(`Uncaught exception: ${error.message}`);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled rejection: ${reason}`);
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
