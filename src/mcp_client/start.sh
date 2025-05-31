#!/bin/bash

# Start script for MCP Debug Client

echo "🚀 Starting MCP Debug Client..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the mcp_client directory."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing client dependencies..."
    npm install
fi

# Install bridge server dependencies
echo "📦 Installing bridge server dependencies..."
npm install express cors @modelcontextprotocol/sdk

# Build the parent MCP server if needed
if [ ! -f "../../build/mcp.js" ]; then
    echo "🔨 Building MCP server..."
    cd ../..
    npx tsc --outDir build
    cd src/mcp_client
fi

echo ""
echo "🌉 Starting MCP Bridge Server (port 3002)..."
node bridge-server.js &
BRIDGE_PID=$!

# Wait a moment for bridge server to start
sleep 2

# Start the development server
echo "🌐 Starting development server on http://localhost:3001"
echo ""
echo "Features available:"
echo "  • Configure MCP server settings"
echo "  • Test MCP tools (similar_functions, function_callers, etc.)"
echo "  • Browse MCP resources"  
echo "  • Chat with Claude using MCP tools"
echo "  • Development mode with mock data"
echo ""
echo "🔗 Bridge server running on http://localhost:3002"
echo "Press Ctrl+C to stop both servers"

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Stopping servers..."
    kill $BRIDGE_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

npm run dev
