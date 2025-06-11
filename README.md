# GraphSense Code Graph RAG

A powerful code analysis and retrieval system that combines graph databases, vector search, and AI to understand and query codebases through natural language. GraphSense indexes JavaScript/TypeScript codebases into both a Neo4j graph database and a PostgreSQL vector database, enabling sophisticated queries about code structure, dependencies, and semantic relationships.

## Features

- **Multi-Modal Code Analysis**: Combines graph-based structural analysis with semantic vector search
- **Natural Language Queries**: Ask questions about your codebase in plain English
- **Function Discovery**: Find functions based on semantic similarity and structural relationships
- **Dependency Tracking**: Understand import relationships and function call hierarchies
- **AI-Powered Summaries**: Automatically generates summaries for functions using AI
- **Real-time Analysis**: Processes codebases incrementally with file watching
- **MCP Integration**: Supports Model Context Protocol for AI assistant integration

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
- Docker and Docker Compose
- Git
- API Keys for:
  - Google Generative AI (Gemini)
  - Anthropic (Claude)
  - Pinecone
  - Cohere
  - Neon Database (optional)
  - GitHub Personal Access Token

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd code-graph-rag
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file with the following variables:
   ```env
   GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key
   ANTHROPIC_API_KEY=your_claude_api_key
   PINECONE_API_KEY=your_pinecone_api_key
   COHERE_API_KEY=your_cohere_api_key
   NEON_API_KEY=your_neon_api_key
   GITHUB_PAT=your_github_personal_access_token
   REPO_URI=https://github.com/your-org/your-repo.git
   HOME=/path/to/home/directory
   ```

4. **Start the databases**
   ```bash
   docker-compose up -d
   ```

5. **Build the project**
   ```bash
   npm run build
   ```

## Usage

### Indexing a Repository

1. **Set the repository URI** in your `.env` file:
   ```env
   REPO_URI=https://github.com/your-org/your-repo.git
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

### Starting the API Server

```bash
npm run server
```

The server will start on port 8080 with the following endpoints:

### API Endpoints

#### Chat Interface
- `GET /chat/query/:query_id?description=<query>` - Stream AI responses with tool integration

#### Function Search
- `GET /functions/search?description=<description>` - Find functions by semantic similarity
- `GET /functions/:id` - Get detailed function information with call graph

#### Query Planning
- `GET /decide?queryText=<query>` - Determine whether to use graph or vector search
- `GET /plan?userQuery=<query>&description=<desc>&decision=<type>` - Execute planned query
- `PUT /prompt` - Stream natural language answers based on graph data

#### Vector Search
- `GET /vector?text=<query>` - Direct vector search interface

### MCP Integration

The system supports Model Context Protocol for integration with AI assistants:

```bash
node build/mcp.js
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
├── api.ts          # Main API server and endpoints
├── db.ts           # Database setup and connections
├── env.ts          # Environment configuration
├── index.ts        # Main indexing logic
├── infer.ts        # Direct inference utilities
├── mcp.ts          # Model Context Protocol server
├── parse.ts        # Code parsing and AI processing
└── planner.ts      # Query planning and execution
```

### Key Components

- **Code Parser**: TypeScript AST parsing for function extraction
- **AI Processor**: Function summarization using Gemini
- **Graph Builder**: Neo4j relationship construction
- **Vector Indexer**: Pinecone embedding storage
- **Query Planner**: Intelligent routing between graph and vector search
- **Streaming API**: Real-time response streaming

### Building

```bash
# Compile TypeScript
npx tsc

# Watch mode for development
npx tsc --watch
```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Ensure Docker containers are running
   - Check port availability (5432, 7474, 7687)

2. **API Key Issues**
   - Verify all required API keys are set
   - Check API key permissions and quotas

3. **Memory Issues**
   - Large repositories may require increased Node.js memory
   - Use `--max-old-space-size=4096` flag

4. **Parsing Errors**
   - Ensure repository contains valid JavaScript/TypeScript
   - Check file permissions and access

### Performance Optimization

- Use incremental indexing for large repositories
- Adjust batch sizes for vector operations
- Configure database connection pools
- Monitor API rate limits

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