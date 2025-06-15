FROM node:20-alpine

WORKDIR /app

# Install git (required for cloning repositories)
RUN apk add --no-cache git

# Copy package files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install -g typescript
RUN npm install --loglevel verbose

# Copy source code
COPY src/ ./src/
COPY db/ ./db/
COPY .env.template ./

# Build the application
RUN tsc

# Create directory for the repository
RUN mkdir -p /home/repo

# Expose the port
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV LOG_LEVEL=info
ENV NEO4J_URI=bolt://neo4j:7687
ENV NEO4J_USERNAME=neo4j
ENV NEO4J_PASSWORD=""
ENV LOCAL_REPO_PATH=/home/repo

CMD ["node", "build/index.js"]
