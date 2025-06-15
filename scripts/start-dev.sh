#!/bin/bash

# Development startup script for Code Graph RAG
# This script sets up the development environment and starts the application

set -e  # Exit on any error

# Make this script executable
chmod +x "$0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Code Graph RAG Development Environment${NC}"
echo

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found${NC}"
    echo -e "${BLUE}📋 Creating .env file from template...${NC}"

    if [ -f ".env.template" ]; then
        cp .env.template .env
        echo -e "${GREEN}✅ .env file created from template${NC}"
        echo -e "${YELLOW}⚠️  Please edit .env file with your actual values before continuing${NC}"
        echo -e "${BLUE}💡 Required variables: REPO_URI, API keys, etc.${NC}"
        echo
        read -p "Press Enter to continue after editing .env file, or Ctrl+C to exit..."
    else
        echo -e "${RED}❌ .env.template file not found${NC}"
        exit 1
    fi
fi

# Load environment variables
if [ -f ".env" ]; then
    echo -e "${BLUE}📖 Loading environment variables...${NC}"
    export $(grep -v '^#' .env | xargs)
fi

# Validate required environment variables
echo -e "${BLUE}🔍 Validating environment variables...${NC}"
required_vars=(
    "REPO_URI"
    "GOOGLE_GENERATIVE_AI_API_KEY"
    "ANTHROPIC_API_KEY"
    "PINECONE_API_KEY"
    "CO_API_KEY"
    "NEON_API_KEY"
)

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo -e "${RED}❌ Missing required environment variables:${NC}"
    for var in "${missing_vars[@]}"; do
        echo -e "${RED}   - $var${NC}"
    done
    echo
    echo -e "${YELLOW}💡 Please set these variables in your .env file${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All required environment variables are set${NC}"

# Check if Node.js dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 Installing Node.js dependencies...${NC}"
    npm install
fi

# Check if TypeScript is compiled
if [ ! -d "build" ]; then
    echo -e "${BLUE}🔨 Compiling TypeScript...${NC}"
    npx tsc
fi

# Set development environment variables
export NODE_ENV=development
export LOG_LEVEL=debug
export DEBUG=graphsense:*

echo
echo -e "${GREEN}🔧 Development Environment Configuration:${NC}"
echo -e "   Node Environment: ${NODE_ENV}"
echo -e "   Port: ${PORT:-8080}"
echo -e "   Log Level: ${LOG_LEVEL}"
echo -e "   Repository: ${REPO_URI}"
echo -e "   Debug: ${DEBUG}"
echo

# Start the application with file watching
echo -e "${BLUE}🏃 Starting application with file watching...${NC}"
echo -e "${YELLOW}💡 The application will restart automatically when files change${NC}"
echo -e "${YELLOW}💡 Health check available at: http://localhost:${PORT:-8080}/health${NC}"
echo -e "${YELLOW}💡 Press Ctrl+C to stop${NC}"
echo

# Run the application with nodemon for auto-restart
if command -v nodemon &> /dev/null; then
    nodemon --watch src --ext ts --exec "npm run build && node build/api.js"
else
    echo -e "${YELLOW}⚠️  nodemon not found, using basic file watching...${NC}"
    npm run server
fi
