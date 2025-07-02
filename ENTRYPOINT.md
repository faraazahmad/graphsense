# GraphSense Entrypoint Scripts

This document explains how to use the entrypoint scripts to run the GraphSense Code Analysis Platform with all its components.

## Quick Start

**For most users, the shell script is the easiest way to get started:**

```bash
# Quick development start (no indexing, faster)
./start.sh --mode dev /path/to/your/repo

# Full production setup (with indexing)
./start.sh /path/to/your/repo

# Or use npm scripts
npm run start:shell -- --mode dev /path/to/repo
```

## Overview

GraphSense consists of three main components that work together:

1. **API Server** (`api.js`) - REST API and web interface
2. **File Watcher** (`watcher.js`) - Monitors repository changes and updates the index
3. **MCP Server** (`mcp.js`) - Model Context Protocol server for AI integrations

The entrypoint scripts orchestrate all these components to provide a complete code analysis platform.

## Available Entrypoints

### 1. Shell Script Wrapper (`start.sh`) - **Recommended**

**User-friendly shell script with command-line options**

```bash
# Basic usage
./start.sh [OPTIONS] [REPO_PATH]

# Examples
./start.sh --mode dev /path/to/repo          # Development mode
./start.sh --skip-indexing /path/to/repo     # Skip initial indexing
./start.sh --help                            # Show all options
```

**Features:**
- Simple command-line interface with helpful options
- Automatic dependency checking and building
- Clear logging with colored output
- Graceful shutdown handling
- Supports both development and production modes
- Built-in help system

### 2. Production Entrypoint (`entrypoint.js`)

**Full-featured production setup with initial indexing**

```bash
# Using npm script
npm run start:full

# Or directly
node entrypoint.js
```

**Features:**
- Builds the TypeScript project
- Runs complete initial repository indexing
- Starts API server, file watcher, and MCP server
- Includes health monitoring and graceful shutdown
- Production-optimized logging and error handling

### 2. Development Entrypoint (`entrypoint-dev.js`)

**Lightweight development setup without initial indexing**

```bash
# Using npm script (recommended)
npm run dev:entrypoint

# Or directly with repository path
node entrypoint-dev.js /path/to/your/repo

# Or set environment variable
LOCAL_REPO_PATH=/path/to/repo node entrypoint-dev.js
```

**Features:**
- Builds only if needed
- Skips initial indexing (faster startup)
- Starts API server and file watcher
- MCP server is optional (commented out by default)
- Development-friendly logging

## Environment Variables

### Required
- `LOCAL_REPO_PATH` - Path to the repository to analyze
- `NEO4J_URI` - Neo4j database connection string
- `NEO4J_USERNAME` - Neo4j username
- `NEO4J_PASSWORD` - Neo4j password

### Optional
- `PORT` - API server port (default: 8080)
- `NODE_ENV` - Environment mode (development/production)
- `LOG_LEVEL` - Logging verbosity (default: info)

### AI/Vector Database (if using AI features)
- `ANTHROPIC_API_KEY` - For Claude AI integration
- `GOOGLE_GENERATIVE_AI_API_KEY` - For Gemini integration

- `PINECONE_API_KEY` - Pinecone vector database

## Usage Examples

### Recommended: Shell Script

```bash
# Quick development start (fastest)
./start.sh --mode dev /path/to/repo

# Production with full indexing
./start.sh /path/to/repo

# Skip build step (if already built)
./start.sh --skip-build --mode dev /path/to/repo

# Get help
./start.sh --help
```

### Docker Production Deployment

```bash
# Build and run with Docker
docker build -t graphsense .
docker run -d \
  -p 8080:8080 \
  -v /path/to/your/repo:/home/repo:ro \
  -e NEO4J_URI=bolt://neo4j:7687 \
  -e NEO4J_USERNAME=neo4j \
  -e NEO4J_PASSWORD=password \
  --name graphsense \
  graphsense
```

### Local Development (Alternative Methods)

```bash
# Option 1: Shell script (recommended)
./start.sh --mode dev /path/to/repo

# Option 2: Quick development start (no indexing)
npm run dev:entrypoint /path/to/repo

# Option 3: Full setup with indexing
npm run start:full

# Option 4: Manual indexing first, then development mode
npm start /path/to/repo  # Run indexing
npm run dev:entrypoint /path/to/repo  # Start services
```

### Manual Component Management

If you need to run components individually:

```bash
# Build first
npm run build

# Start API server only
node build/api.js

# Start file watcher only
node build/watcher.js /path/to/repo

# Start MCP server only
node build/mcp.js

# Run initial indexing only
node build/index.js /path/to/repo
```

## Service Endpoints

Once running, the following endpoints are available:

- **API Server**: `http://localhost:8080`
- **Health Check**: `http://localhost:8080/health`
- **Function Search**: `http://localhost:8080/functions/search?description=...`
- **Chat Interface**: `http://localhost:8080/chat/query/:id?description=...`

## Process Management

### Graceful Shutdown

Both entrypoint scripts handle graceful shutdown:

```bash
# Send interrupt signal
Ctrl+C

# Or send TERM signal
kill -TERM <pid>
```

### Health Monitoring

The production entrypoint includes automated health monitoring:
- Checks process status every 30 seconds
- Logs warnings for failed processes
- Automatic restart capabilities (can be extended)

## Troubleshooting

### Common Issues

1. **Build Directory Missing**
   ```
   ERROR: Build directory not found. Please run "npm run build" first.
   ```
   **Solution**: Run `npm run build`, use `./start.sh` (auto-builds), or use scripts that include building

2. **Repository Path Invalid**
   ```
   ERROR: Repository path does not exist: /path/to/repo
   ```
   **Solution**: Check that the path exists, or use `./start.sh --help` for usage examples

3. **Database Connection Failed**
   ```
   ERROR: Failed to connect to Neo4j
   ```
   **Solution**: Verify Neo4j is running and connection parameters are correct

4. **Port Already in Use**
   ```
   ERROR: Port 8080 is already in use
   ```
   **Solution**: Set different port with `PORT=3000 ./start.sh /path/to/repo`

5. **Permission Denied**
   ```
   ERROR: Permission denied: ./start.sh
   ```
   **Solution**: Make script executable with `chmod +x start.sh`

### Debug Mode

Enable verbose logging:

```bash
# Shell script with debug logs
LOG_LEVEL=debug ./start.sh --mode dev /path/to/repo

# Development mode with debug logs
NODE_ENV=development LOG_LEVEL=debug npm run dev:entrypoint

# Check process status
npm run health
```

### File Permissions

If you get permission errors:

```bash
# Make scripts executable
chmod +x start.sh entrypoint.js entrypoint-dev.js

# Or use npm scripts which handle permissions
npm run start:shell
npm run start:full
npm run dev:entrypoint
```

## Architecture Notes

### Process Communication

- **API Server**: HTTP/REST endpoints
- **File Watcher**: Monitors filesystem, updates database
- **MCP Server**: Stdio-based communication for AI tools

### Data Flow

1. **Initial Indexing**: Parses repository → Neo4j graph + vector embeddings
2. **File Watching**: File changes → incremental updates
3. **API Queries**: User requests → graph queries + AI analysis
4. **MCP Integration**: AI tools → structured data access

### Scaling Considerations

- File watcher can be resource-intensive for large repositories
- Consider running indexing as a separate scheduled job for very large codebases
- API server can be horizontally scaled (stateless)
- MCP server typically runs per-client connection

## Contributing

When modifying entrypoint scripts:

1. Test both development and production modes
2. Ensure graceful shutdown works properly
3. Add appropriate logging for debugging
4. Update this documentation for new features

## Summary of Available Scripts

| Script | Purpose | Best For |
|--------|---------|----------|
| `./start.sh` | Shell wrapper with CLI options | **Most users** - easy to use |
| `npm run start:shell` | NPM wrapper for shell script | NPM workflow users |
| `node entrypoint.js` | Production entrypoint | Docker/production |
| `node entrypoint-dev.js` | Development entrypoint | Quick development |
| `npm run start:full` | NPM production wrapper | NPM workflow |
| `npm run dev:entrypoint` | NPM development wrapper | NPM workflow |

## Related Files

- `start.sh` - **Recommended shell script wrapper**
- `entrypoint.js` - Production orchestration script
- `entrypoint-dev.js` - Development orchestration script
- `src/api.ts` - Main API server implementation
- `src/watcher.ts` - File monitoring implementation  
- `src/mcp.ts` - MCP server implementation
- `src/index.ts` - Initial indexing logic
- `Dockerfile` - Container configuration
- `docker-compose.yml` - Multi-service orchestration