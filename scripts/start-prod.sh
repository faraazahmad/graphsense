#!/bin/bash

# Production startup script for Code Graph RAG
# This script starts the application in production mode with proper health checks

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Code Graph RAG Production Environment${NC}"
echo

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
    echo -e "${YELLOW}💡 Please set these variables in your environment${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All required environment variables are set${NC}"

# Set production environment variables
export NODE_ENV=production
export LOG_LEVEL=${LOG_LEVEL:-info}
export PORT=${PORT:-8080}

# Disable debug logging in production
export DEBUG=""

# Security settings
export CORS_ORIGIN=${CORS_ORIGIN:-"https://your-frontend-domain.com"}
export RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-100}
export RATE_LIMIT_WINDOW=${RATE_LIMIT_WINDOW:-900000}

echo
echo -e "${GREEN}🔧 Production Environment Configuration:${NC}"
echo -e "   Node Environment: ${NODE_ENV}"
echo -e "   Port: ${PORT}"
echo -e "   Log Level: ${LOG_LEVEL}"
echo -e "   CORS Origin: ${CORS_ORIGIN}"
echo -e "   Rate Limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW}ms"
echo

# Check if build directory exists
if [ ! -d "build" ]; then
    echo -e "${RED}❌ Build directory not found${NC}"
    echo -e "${YELLOW}💡 Please run 'npm run build' or 'npx tsc' to compile TypeScript${NC}"
    exit 1
fi

# Check if required build files exist
if [ ! -f "build/api.js" ]; then
    echo -e "${RED}❌ Built application files not found${NC}"
    echo -e "${YELLOW}💡 Please ensure the application is properly built${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build files found${NC}"

# Create logs directory if it doesn't exist
mkdir -p logs

# Start the application
echo -e "${BLUE}🏃 Starting production server...${NC}"
echo -e "${YELLOW}💡 Health check available at: http://localhost:${PORT}/health${NC}"
echo -e "${YELLOW}💡 Logs are being written to: logs/app.log${NC}"
echo -e "${YELLOW}💡 Press Ctrl+C to stop${NC}"
echo

# Use PM2 if available for production process management
if command -v pm2 &> /dev/null; then
    echo -e "${BLUE}📋 Using PM2 for process management...${NC}"

    # Create PM2 ecosystem file if it doesn't exist
    if [ ! -f "ecosystem.config.js" ]; then
        cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'code-graph-rag',
    script: 'build/api.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: ${PORT}
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    time: true
  }]
};
EOF
        echo -e "${GREEN}✅ PM2 ecosystem configuration created${NC}"
    fi

    # Start with PM2
    pm2 start ecosystem.config.js
    echo -e "${GREEN}✅ Application started with PM2${NC}"
    echo -e "${YELLOW}💡 Use 'pm2 status' to check status${NC}"
    echo -e "${YELLOW}💡 Use 'pm2 logs' to view logs${NC}"
    echo -e "${YELLOW}💡 Use 'pm2 stop code-graph-rag' to stop${NC}"

else
    # Fallback to direct node execution with output redirection
    echo -e "${YELLOW}⚠️  PM2 not found, starting with Node.js directly...${NC}"
    echo -e "${YELLOW}💡 Consider installing PM2 for better production process management${NC}"
    echo -e "${YELLOW}💡 npm install -g pm2${NC}"
    echo

    # Start the application and redirect logs
    node build/api.js 2>&1 | tee logs/app.log
fi
