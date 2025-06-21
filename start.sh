#!/bin/bash

# GraphSense Code Analysis Platform Startup Script
# This script provides a simple interface to start GraphSense services

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
MODE="production"
REPO_PATH=""
BUILD_FIRST="true"
SKIP_INDEXING="false"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] [STARTUP]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] [SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] [WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] [ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
GraphSense Code Analysis Platform Startup Script

USAGE:
    $0 [OPTIONS] [REPO_PATH]

OPTIONS:
    -m, --mode MODE         Set mode: production, development, dev (default: production)
    -r, --repo PATH         Repository path to analyze
    -s, --skip-build        Skip TypeScript build step
    -i, --skip-indexing     Skip initial repository indexing
    -h, --help              Show this help message

MODES:
    production              Full production setup with all services and indexing
    development, dev        Development mode without initial indexing

EXAMPLES:
    # Production mode with full indexing
    $0 /path/to/repo

    # Development mode (faster startup)
    $0 --mode dev /path/to/repo

    # Skip build and indexing for quick restart
    $0 --skip-build --skip-indexing /path/to/repo

    # Use environment variable for repo path
    LOCAL_REPO_PATH=/path/to/repo $0 --mode dev

ENVIRONMENT VARIABLES:
    LOCAL_REPO_PATH         Repository path (can be overridden by argument)
    PORT                    API server port (default: 8080)
    NODE_ENV               Node environment mode
    NEO4J_URI              Neo4j connection string
    NEO4J_USERNAME         Neo4j username
    NEO4J_PASSWORD         Neo4j password

For more detailed information, see ENTRYPOINT.md
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -r|--repo)
            REPO_PATH="$2"
            shift 2
            ;;
        -s|--skip-build)
            BUILD_FIRST="false"
            shift
            ;;
        -i|--skip-indexing)
            SKIP_INDEXING="true"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            # Assume it's the repository path
            REPO_PATH="$1"
            shift
            ;;
    esac
done

# Normalize mode aliases
case "$MODE" in
    dev|development)
        MODE="development"
        ;;
    prod|production)
        MODE="production"
        ;;
    *)
        log_error "Invalid mode: $MODE. Use 'production' or 'development'"
        exit 1
        ;;
esac

# Determine repository path
if [[ -z "$REPO_PATH" ]]; then
    if [[ -n "$LOCAL_REPO_PATH" ]]; then
        REPO_PATH="$LOCAL_REPO_PATH"
        log "Using repository path from environment: $REPO_PATH"
    else
        log_error "Repository path not specified"
        log_error "Use: $0 /path/to/repo"
        log_error "Or set: LOCAL_REPO_PATH=/path/to/repo"
        exit 1
    fi
else
    log "Using repository path from argument: $REPO_PATH"
fi

# Validate repository path
if [[ ! -d "$REPO_PATH" ]]; then
    log_error "Repository path does not exist: $REPO_PATH"
    exit 1
fi

# Export repository path for child processes
export LOCAL_REPO_PATH="$REPO_PATH"

# Pre-flight checks
log "Starting GraphSense Code Analysis Platform..."
log "Mode: $MODE"
log "Repository: $REPO_PATH"
log "Build first: $BUILD_FIRST"
log "Skip indexing: $SKIP_INDEXING"

# Check Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed or not in PATH"
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    log_error "npm is not installed or not in PATH"
    exit 1
fi

# Check package.json
if [[ ! -f "package.json" ]]; then
    log_error "package.json not found. Are you in the GraphSense directory?"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [[ ! -d "node_modules" ]]; then
    log "Installing Node.js dependencies..."
    npm install
fi

# Build TypeScript if needed
if [[ "$BUILD_FIRST" == "true" ]]; then
    if [[ ! -d "build" ]] || [[ "$MODE" == "production" ]]; then
        log "Building TypeScript project..."
        npm run build
        log_success "Build completed"
    else
        log "Build directory exists, skipping build (use --skip-build=false to force)"
    fi
fi

# Validate build directory
if [[ ! -d "build" ]]; then
    log_error "Build directory not found. TypeScript compilation may have failed."
    exit 1
fi

# Set up environment
if [[ "$MODE" == "development" ]]; then
    export NODE_ENV="development"
else
    export NODE_ENV="production"
fi

# Prepare cleanup function
cleanup() {
    log "Received interrupt signal, shutting down..."
    if [[ -n "$ENTRYPOINT_PID" ]]; then
        kill -TERM "$ENTRYPOINT_PID" 2>/dev/null || true
        wait "$ENTRYPOINT_PID" 2>/dev/null || true
    fi
    log_success "Shutdown complete"
    exit 0
}

# Set up signal handling
trap cleanup SIGINT SIGTERM

# Choose and start the appropriate entrypoint
if [[ "$MODE" == "development" ]] || [[ "$SKIP_INDEXING" == "true" ]]; then
    log "Starting development mode (no initial indexing)..."

    # Make sure the script is executable
    chmod +x entrypoint-dev.js 2>/dev/null || true

    # Start development entrypoint
    node entrypoint-dev.js "$REPO_PATH" &
    ENTRYPOINT_PID=$!
else
    log "Starting production mode (with initial indexing)..."

    # Make sure the script is executable
    chmod +x entrypoint.js 2>/dev/null || true

    # Start production entrypoint
    node entrypoint.js &
    ENTRYPOINT_PID=$!
fi

# Wait for entrypoint to start
sleep 2

# Check if the process is still running
if ! kill -0 "$ENTRYPOINT_PID" 2>/dev/null; then
    log_error "Entrypoint process failed to start or crashed immediately"
    exit 1
fi

log_success "GraphSense services started successfully!"
log "Process ID: $ENTRYPOINT_PID"
log "API Server: http://localhost:${PORT:-8080}"
log "Health Check: http://localhost:${PORT:-8080}/health"
log ""
log "Press Ctrl+C to stop all services"

# Wait for the entrypoint process
wait "$ENTRYPOINT_PID"
exit_code=$?

if [[ $exit_code -eq 0 ]]; then
    log_success "GraphSense stopped normally"
else
    log_error "GraphSense stopped with exit code $exit_code"
fi

exit $exit_code
