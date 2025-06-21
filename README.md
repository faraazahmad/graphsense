# GraphSense Code Graph RAG

A powerful code analysis and retrieval system that combines graph databases, vector search, and AI to understand and query codebases through natural language. GraphSense indexes JavaScript/TypeScript codebases into both a Neo4j graph database and a PostgreSQL vector database, enabling sophisticated queries about code structure, dependencies, and semantic relationships.

## 🚀 Quick Start

The fastest way to get started is with our interactive setup script:

```bash
./quick-start.sh
```

Or choose your preferred method:

```bash
# Local development
./quick-start.sh dev

# Docker development
./quick-start.sh docker

# Production deployment
./quick-start.sh prod

# Validate configuration
./quick-start.sh validate
```

### One-Command Setup

```bash
# Development with npm
npm run dev

# Docker environment
npm run docker:setup

# Production
npm run prod
```

## Features

- **Multi-Modal Code Analysis**: Combines graph-based structural analysis with semantic vector search
- **Natural Language Queries**: Ask questions about your codebase in plain English
- **Function Discovery**: Find functions based on semantic similarity and structural relationships
- **Dependency Tracking**: Understand import relationships and function call hierarchies
- **AI-Powered Summaries**: Automatically generates summaries for functions using AI
- **Real-time Analysis**: Processes codebases incrementally with file watching
- **MCP Integration**: Supports Model Context Protocol for AI assistant integration over HTTP

> **📢 Important**: If you're upgrading from a previous version with API server, see [MIGRATION.md](MIGRATION.md) for migration instructions.

## Model Context Protocol (MCP) Integration

GraphSense provides an HTTP-based MCP server to integrate with AI assistants like Claude Desktop, enabling natural language queries about your codebase.

#### MCP HTTP Server

```bash
# Start MCP server on HTTP (default port 3000)
npm run build && node build/mcp.js

# Or set custom port
MCP_PORT=4000 npm run build && node build/mcp.js
```

### Available MCP Tools

- **`similar_functions`** - Find functions based on semantic description
- **`function_callers`** - Find functions that call a specific function
- **`function_callees`** - Find functions called by a specific function
- **`function_details`** - Get detailed information about a function

### Testing MCP Integration

```bash
# Check server health
curl http://localhost:3000/health

# Test MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}'
```

## Architecture

The system uses a hybrid approach combining:

1. **Neo4j Graph Database**: Stores structural relationships between files and functions
   - File nodes with path properties
   - Function nodes with name and path properties
   - IMPORTS_FROM relationships between files
   - CALLS relationships between functions

2. **PostgreSQL with pgvector**: Stores function embeddings for semantic search
   - Function metadata and code summaries
   - Vector embeddings for similarity search
   - Hybrid dense/sparse search with reranking

3. **Pinecone Vector Databases**: Dual-index setup for enhanced search
   - Dense embeddings index
   - Sparse embeddings index
   - Cohere reranking for result optimization

## Prerequisites

- Node.js 16+
- Docker and Docker Compose (for Docker deployment)
- Git
- API Keys for:
  - Google Generative AI (Gemini) - [Get API Key](https://aistudio.google.com/app/apikey)
  - Anthropic (Claude) - [Get API Key](https://console.anthropic.com/)
  - Pinecone - [Get API Key](https://app.pinecone.io/)
  - Cohere - [Get API Key](https://dashboard.cohere.ai/api-keys)

## Installation & Setup

### Option 1: Interactive Setup (Recommended)

```bash
git clone <repository-url>
cd code-graph-rag
./quick-start.sh
```

### Option 2: Manual Setup

1. **Clone and install**
   ```bash
   git clone <repository-url>
   cd code-graph-rag
   npm install
   ```

2. **Configure environment**
   ```bash
   # Copy template and edit with your values
   cp .env.template .env
   nano .env

   # Validate configuration
   npm run env:validate
   ```

3. **Choose deployment method**

   **Local Development:**
   ```bash
   npm run dev
   ```

   **Docker Development:**
   ```bash
   npm run docker:setup
   ```

   **Production:**
   ```bash
   npm run prod
   ```

### Environment Variables

Required variables (must be set):
- `GOOGLE_GENERATIVE_AI_API_KEY` - Gemini API key
- `ANTHROPIC_API_KEY` - Claude API key
- `CO_API_KEY` - Cohere API key
- `PINECONE_API_KEY` - Pinecone API key

- `HOME` - Home directory path

### Database Configuration

The system uses two databases:

- **PostgreSQL with pgvector**: Stores function embeddings and metadata
- **Neo4j**: Stores code structure and relationships

When using Docker (recommended), both databases are automatically configured via `docker-compose.yml`:

```yaml
# PostgreSQL with pgvector extension
postgres:
  image: pgvector/pgvector:pg16
  environment:
    - POSTGRES_DB=graphsense
    - POSTGRES_USER=postgres
    - POSTGRES_PASSWORD=postgres
  ports:
    - "5432:5432"

# Neo4j graph database
neo4j:
  image: neo4j:latest
  environment:
    - NEO4J_AUTH=none
  ports:
    - "7474:7474"  # Web interface
    - "7687:7687"  # Bolt protocol
```

**Local Development**: The application connects to `localhost:5432` (PostgreSQL) and `localhost:7687` (Neo4j) by default.

**Docker Development**: Connections are handled automatically via Docker networking.

Optional variables:
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 8080)
- `LOG_LEVEL` - Logging level (default: info)

See [ENVIRONMENT.md](ENVIRONMENT.md) for complete configuration guide.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development services (file watcher + MCP server) |
| `npm run prod` | Start production services |
| `npm run watch` | Start file watcher for real-time code analysis |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Run initial indexing on a repository |
| `npm run docker:setup` | Complete Docker environment setup |
| `npm run docker:start` | Start Docker services |
| `npm run docker:stop` | Stop Docker services |
| `npm run docker:logs` | View Docker logs |
| `npm run env:validate` | Validate environment configuration |

## Usage

### Indexing a Repository

1. **Set the repository URI** in your `.env` file:
   ```env
   # No longer needed - repository path is passed as command line argument
   ```

2. **Run the indexing process**:
   ```bash
   node build/index.js
   ```

   This will:
   - Clone the repository (if remote)
   - Parse JavaScript/TypeScript files
   - Extract function definitions and import relationships
   - Generate AI summaries for functions
   - Create vector embeddings
   - Store everything in Neo4j and PostgreSQL

### Real-time File Watching

For continuous monitoring and real-time code analysis, use the file watcher:

```bash
# Watch current directory
npm run watch .

# Watch specific directory
npm run watch /path/to/your/codebase

# Or use directly with Node.js
node build/watcher.js /path/to/watch
```

The file watcher will:
- Monitor specified directory for file changes (recursively)
- Watch `.js`, `.ts`, and `.json` files by default
- Ignore `node_modules`, `.git`, `build`, `dist`, and log files
- Debounce changes (1 second delay) to avoid duplicate processing
- Automatically call `index.ts` with the changed file's absolute path
- Process files incrementally as they're modified

**File Watcher Features:**
- **Recursive Monitoring**: Watches entire directory trees
- **Smart Filtering**: Only processes relevant file types
- **Debouncing**: Prevents duplicate processing of rapid changes
- **Graceful Shutdown**: Handles Ctrl+C and termination signals
- **Error Handling**: Continues monitoring even if individual files fail
- **Real-time Logging**: Shows which files are being processed

**Example Usage:**
```bash
# Start watching your project directory
npm run watch /home/user/my-project

# Output:
# Starting file watcher on: /home/user/my-project
# Watching extensions: .js, .ts, .json
# File watcher started successfully
# File changed: /home/user/my-project/src/utils.ts
# Calling index.ts with path: /home/user/my-project/src/utils.ts
# Successfully processed: /home/user/my-project/src/utils.ts
```

To stop the watcher, press `Ctrl+C` for graceful shutdown.

### Starting the Services

The services start automatically with the setup scripts:

```bash
# Development mode (includes file watcher and MCP server)
npm run dev

# Production mode
npm run prod

# Development with entrypoint
npm run dev:entrypoint
```

The system will start the following services:
- **File Watcher**: Monitors repository for changes and processes files automatically
- **MCP HTTP Server**: Provides AI assistant integration on port 3000 (configurable via `MCP_PORT`)

### MCP HTTP Endpoints

#### Health & Status
- `GET /health` - MCP server health check

#### MCP Protocol
- `POST /mcp` - Main MCP endpoint for client-server communication
- `GET /mcp` - Server-to-client notifications via SSE
- `DELETE /mcp` - Session termination

**Example Health Check:**
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "service": "GraphSense MCP HTTP Server (Fastify)",
  "version": "1.0.0",
  "activeSessions": 0
}
```

### MCP Integration

The system provides an HTTP-based MCP server for integration with AI assistants:

```bash
# Start MCP HTTP server
node build/mcp.js

# Or with custom port
MCP_PORT=4000 node build/mcp.js
```

Available MCP tools:
- `similar_functions`: Search functions by semantic meaning
- `function_callers`: Find functions that call a specific function
- `function_callees`: Find functions called by a specific function
- `function_details`: Get detailed information about a function

### Example Queries

**Natural Language Queries:**
- "Find all functions that handle user authentication"
- "Which functions have more than 5 callers?"
- "Show me functions related to database operations"
- "What files import the authentication module?"

**Structural Queries:**
- Functions with high coupling (many callers/callees)
- Import dependency chains
- Orphaned functions (no callers)
- Cross-module function calls

## Configuration

### Database Schema

**Neo4j Constraints:**
- Unique file paths
- Unique function name-path combinations

**PostgreSQL Schema:**
- Functions table with vector embeddings
- Support for pgvector similarity search

### AI Models

The system uses multiple AI providers:
- **Gemini 2.0**: Primary model for function summarization and query planning
- **Claude 3.5 Sonnet**: Backup model and natural language processing
- **Cohere**: Reranking for search results

### Vector Search

Hybrid search approach:
1. Dense vector search (semantic similarity)
2. Sparse vector search (keyword matching)
3. Result merging and deduplication
4. Cohere reranking for optimal results

## Development

### Project Structure

```
src/
├── db.ts           # Database setup and connections
├── env.ts          # Environment configuration
├── index.ts        # Main indexing logic
├── mcp.ts          # Model Context Protocol HTTP server
├── parse.ts        # Code parsing and AI processing
└── watcher.ts      # File watcher for real-time analysis
```

### Key Components

- **Code Parser**: TypeScript AST parsing for function extraction
- **AI Processor**: Function summarization using Gemini
- **Graph Builder**: Neo4j relationship construction
- **Vector Indexer**: Pinecone embedding storage
- **MCP HTTP Server**: Model Context Protocol server for AI assistant integration
- **File Watcher**: Real-time code analysis and indexing

### Building

```bash
# Compile TypeScript
npx tsc

# Watch mode for development
npx tsc --watch
```

## Troubleshooting

### Environment Issues

**Missing API Keys:**
```bash
# Validate your configuration
npm run env:validate

# Check specific issues
❌ Missing required environment variables:
   - GOOGLE_GENERATIVE_AI_API_KEY
```
Solution: Set missing variables in `.env` file or environment.

**Invalid Configuration:**
```bash
# Use validation script for detailed feedback
npm run env:validate
```

### Service Issues

**Database Connection Errors:**
```bash
# Check Docker services
docker-compose ps

# View logs
npm run docker:logs
```

**Application Not Starting:**
```bash
# Check MCP server health
curl http://localhost:3000/health

# View detailed logs
npm run docker:logs
```

### Common Solutions

1. **Environment Setup**
   ```bash
   # Reset environment
   cp .env.template .env
   # Edit .env with your values
   npm run env:validate
   ```

2. **Docker Issues**
   ```bash
   # Restart Docker services
   npm run docker:stop
   npm run docker:start

   # Complete cleanup and restart
   npm run docker:cleanup
   npm run docker:setup
   ```

3. **Memory Issues**
   ```bash
   # Increase Node.js memory
   NODE_OPTIONS="--max-old-space-size=4096" npm run dev
   ```

4. **Port Conflicts**
   ```bash
   # Change MCP port
   MCP_PORT=4000 npm run dev
   ```

### Getting Help

1. **Check Documentation**
   - [MIGRATION.md](MIGRATION.md) - Migration guide for API to MCP HTTP transition
   - [ENVIRONMENT.md](ENVIRONMENT.md) - Environment configuration
   - `.env.template` - Configuration template

2. **Validation Tools**
   ```bash
   npm run env:validate  # Validate configuration
   npm run health        # Check application health
   ```

3. **Debug Information**
   ```bash
   # Enable debug logging
   DEBUG=graphsense:* npm run dev

   # Check MCP server status
   curl http://localhost:3000/health

   # Check service status
   npm run docker:logs
   ```

### Performance Optimization

- Use incremental indexing for large repositories
- Adjust batch sizes for vector operations
- Configure database connection pools
- Monitor API rate limits
- Use production environment variables for better performance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[Add your license information here]

## Support

For issues and questions:
- Check the troubleshooting section
- Review the API documentation
- Open an issue on GitHub
