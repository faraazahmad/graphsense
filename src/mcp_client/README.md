# MCP Debug Client

A Vue.js-based debug client for testing Model Context Protocol (MCP) servers.

## Features

- **Settings Panel**: Configure MCP server connection and Anthropic API key
- **Tools Discovery**: View and test all available MCP tools
- **Resources Browser**: Browse and load MCP resources  
- **Chat Interface**: Chat with Claude 4 using your MCP tools
- **Development Mode**: Test with mock data when server isn't available

## Setup

### Option 1: Quick Start (Recommended)
```bash
cd src/mcp_client
./start.sh
```

This will:
- Install all dependencies
- Start the MCP bridge server (port 3002)
- Start the Vue.js client (port 3001)
- Build the MCP server if needed

### Option 2: Manual Setup

1. Install client dependencies:
   ```bash
   cd src/mcp_client
   npm install
   ```

2. Install bridge server dependencies:
   ```bash
   npm install express cors @modelcontextprotocol/sdk
   ```

3. Build the MCP server:
   ```bash
   cd ../..
   npx tsc --outDir build
   cd src/mcp_client
   ```

4. Start the bridge server:
   ```bash
   node bridge-server.js
   ```

5. In a new terminal, start the client:
   ```bash
   npm run dev
   ```

6. Open http://localhost:3001 in your browser

## Configuration

### MCP Server Settings
- **Server Command**: Usually `node` 
- **Server Arguments**: Path to your MCP server, e.g., `../../build/mcp.js`
- **Anthropic API Key**: Your Claude API key (sk-ant-...)
- **Environment Variables**: Add any environment variables your MCP server needs

### Development Mode
Toggle "Use mock data" to test the interface without connecting to an actual MCP server. This uses predefined mock responses that match the schema of your Code Graph RAG server.

## Usage

1. **Configure Settings**: Enter your MCP server details, Anthropic API key, and any required environment variables
2. **Connect**: Click "Connect to MCP Server" 
3. **Explore Tools**: View available tools and test them with sample inputs
4. **Browse Resources**: Load and inspect available resources
5. **Chat with Claude**: Use the chat interface to interact with Claude using your MCP tools

### Environment Variables
Common environment variables you might need for the Code Graph RAG server:
- `DATABASE_URL`: PostgreSQL connection string
- `NEO4J_URI`: Neo4j database URI  
- `NEO4J_USER`: Neo4j username
- `NEO4J_PASSWORD`: Neo4j password
- `PINECONE_API_KEY`: Pinecone API key
- `OPENAI_API_KEY`: OpenAI API key

## MCP Server Integration

This client is designed to work with the Code Graph RAG MCP server in `src/mcp.ts`, which provides:

- `similar_functions`: Search for functions by description
- `function_callers`: Find functions that call a specific function  
- `function_callees`: Find functions called by a specific function
- `function_details`: Get detailed information about a function

## Architecture

The system consists of three components:

1. **Vue.js Client** (port 3001) - The browser-based UI
2. **Bridge Server** (port 3002) - HTTP-to-MCP protocol translator  
3. **MCP Server** (your actual server) - The Code Graph RAG server

```
Browser → HTTP → Bridge Server → stdio → MCP Server
```

The bridge server is necessary because:
- MCP uses stdio transport which doesn't work in browsers
- The bridge server spawns your MCP server as a child process
- It translates HTTP requests to MCP protocol calls

## Troubleshooting

- **Bridge Server Issues**: Make sure port 3002 is available
- **Connection Issues**: Try development mode first to verify the UI works
- **CORS Errors**: The Anthropic SDK is configured for browser use with `dangerouslyAllowBrowser: true`
- **Server Path**: Make sure the server arguments point to your built MCP server file
- **"global is not defined"**: Fixed by Vite config defining `global: 'globalThis'`

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.
