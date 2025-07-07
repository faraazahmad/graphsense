# GraphSense Code Graph RAG

A code analysis and retrieval system that combines graph databases, vector search, and LLMs to understand and query codebases through natural language.

---

It indexes JavaScript/TypeScript codebases into both a Neo4j graph database and a PostgreSQL vector database, enabling sophisticated queries about code structure, dependencies, and semantic relationships.

## Features

- **Multi-Modal Code Analysis**: Combines graph-based structural analysis with semantic vector search.
- **Natural Language Queries**: Ask questions about your codebase in plain English.
- **Function Discovery**: Find functions based on semantic similarity and structural relationships.
- **Dependency Tracking**: Understand import relationships and function call hierarchies.
- **AI-Powered Summaries**: Automatically generates summaries for functions using LLMs.
- **Real-time Analysis**: Processes codebases incrementally with file watching.
- **MCP Integration**: Integrates with your text editor or AI agent via MCP.

## Quick Start

```bash
# Navigate to your git repository
$ cd ~/path/to/repo

# Run GraphSense from within the repository
$ npx graphsense
```
Note: You will need environment variables declared in `~/.graphsense/.env`:

### Environment Variables

Required variables (must be set):
- `ANTHROPIC_API_KEY` - Claude API key
- `PINECONE_API_KEY` - Pinecone API key

### Prerequisites

- Node.js 16+
- Docker
- Must be run from within a git repository (GraphSense will exit if not)
- API Keys for:
  - Anthropic (Claude) - [Get API Key](https://console.anthropic.com/)
  - Pinecone - [Get API Key](https://app.pinecone.io/)

## Model Context Protocol (MCP) Integration

GraphSense provides an MCP server to integrate with AI assistants like Claude Desktop, enabling natural language queries about your codebase.

### MCP Configuration

The MCP server uses stdio transport and is automatically started when you run the main application.

#### Starting GraphSense MCP

```bash
# Navigate to your git repository
$ cd ~/path/to/repo

# Run GraphSense from within the repository
$ npx graphsense
```

#### Claude Desktop Configuration

Add this to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "graphsense": {
      "command": "npx",
      "args": ["graphsense"],
      "env": {}
    }
  }
}
```

> Note: Your preferred AI coding editor/agent will have similar configuration options.

### Available MCP Tools

- **`similar_functions`** - Find functions based on semantic description
  - Parameters: `function_description` (string), `topK` (number, optional)
  - Returns: Array of similar functions with similarity scores

- **`function_callers`** - Find functions that call a specific function
  - Parameters: `functionId` (string) - The element ID of the target function
  - Returns: Array of caller functions with their IDs and names

- **`function_callees`** - Find functions called by a specific function
  - Parameters: `functionId` (string) - The element ID of the source function
  - Returns: Array of called functions with their IDs and names

- **`function_details`** - Get detailed information about a specific function
  - Parameters: `functionId` (string) - The element ID of the function
  - Returns: Function details including name, code, and summary

### MCP Usage Examples

Once configured, you can use natural language queries in your AI assistant:

#### Example Queries

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

### MCP Troubleshooting

#### Connection Issues

1. **Database Connection Errors**
   ```bash
   # Check if PostgreSQL is running
   docker ps | grep postgres

   # Check if Neo4j is running
   docker ps | grep neo4j

   # Test database connections
   psql -h localhost -p 5432 -U postgres -d graphsense
   ```

2. **Port Conflicts**
   - Default PostgreSQL port: 5432
   - Default Neo4j port: 7687
   - Check `docker ps` output for actual ports if different

3. **Environment Variables**
   Verify required environment variables are set in `~/.graphsense/.env`.
   If not:

   ```bash
   # Create a dedicated config directory
   mkdir -p ~/.graphsense

   # Store environment variables securely
   cat > ~/.graphsense/.env << EOF
   ANTHROPIC_API_KEY=your-key-here
   PINECONE_API_KEY=your-key-here
   EOF

   # Set proper permissions
   chmod 600 ~/.graphsense/.env
   ```

#### Common Issues

- **"No functions found"**: Ensure your repository has been indexed first
- **"Connection refused"**: Check if database containers are running
- **"Permission denied"**: Verify file paths and permissions in MCP config
- **"API key invalid"**: Confirm your Anthropic and Pinecone API keys are correct

#### Debugging MCP Server

```bash
# Run with debug output
DEBUG=* node build/mcp.js

# Check server logs
tail -f ~/.graphsense/logs/mcp.log
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
   - Pinecone similarity-based ranking for result optimization



### Database Configuration

The system uses two databases:

- **PostgreSQL with pgvector**: Stores function embeddings and metadata
- **Neo4j**: Stores code structure and relationships

Both databases are automatically started via docker, for each repository path there will be a
separate set of these 2 databases.

See [ENVIRONMENT.md](ENVIRONMENT.md) for complete configuration guide.

## AI Models

The system uses 2 AI providers:
- **Claude 3.5 Sonnet**: Backup model and natural language processing
- **Pinecone**: Vector embeddings and similarity ranking

### Vector Search

Hybrid search approach:
1. Dense vector search (semantic similarity)
2. Sparse vector search (keyword matching)
3. Result merging and deduplication
4. Pinecone similarity ranking for optimal results

## Development

### Project Structure

```
src/
├── db.ts           # Database setup and connections
├── env.ts          # Environment configuration
├── index.ts        # Main indexing logic
├── mcp.ts          # Model Context Protocol HTTP server
├── parse.ts        # Code parsing and AI processing
├── watcher.ts      # File watcher for real-time analysis
└── entrypoint.ts   # Entrypoint for the package
```

### Building

```bash
# Compile TypeScript
npx tsc

# Watch mode for development
npx tsc --watch
```

## License

Licensed under GPL v3.0
