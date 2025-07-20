# GraphSense Development Guide

## Project Overview
GraphSense is a code analysis tool that creates knowledge graphs from JavaScript/TypeScript codebases, combining Neo4j for structural relationships and PostgreSQL for semantic search.

## Commands

### Build and Test
```bash
# Compile TypeScript
npm run build

# Watch mode for development  
npm run build:watch

# Test graph relations
node build/test-relations.js
```

### Database Setup
- Neo4j: bolt://localhost:7687 (default, no auth)
- PostgreSQL: localhost:5432 with pgvector extension
- Both databases auto-started via Docker

## Key Architecture

### Database Schema
- **Neo4j**: File and Function nodes with :IMPORTS_FROM and :CALLS relationships
- **PostgreSQL**: Function metadata with vector embeddings for semantic search

### File Structure
```
src/
├── index.ts        # Main indexing logic, file parsing
├── parse.ts        # Function parsing, AI summaries, graph relations  
├── db.ts          # Database connections and setup
├── mcp.ts         # Model Context Protocol server
├── env.ts         # Environment configuration
└── entrypoint.ts  # CLI entry point
```

## Known Issues (Fixed)
1. **Missing File nodes**: parseFile() wasn't creating File nodes for the current file being parsed
2. **Wrong caller parameter**: addCallsRelation() was receiving function source text instead of function name
3. **Import relationships**: MATCH pattern required existing File nodes before creating relationships

## Testing
Use `src/test-relations.ts` to verify graph relationship creation:
- File nodes creation
- :IMPORTS_FROM relationships between files  
- Function nodes creation
- :CALLS relationships between functions

## Environment Variables
Required for full functionality:
- `ANTHROPIC_API_KEY` - Claude API for function summaries
- `PINECONE_API_KEY` - Vector embeddings
- `NEO4J_URI`, `POSTGRES_URL` - Database connections (optional, defaults provided)
