# Environment Variables Configuration

This document describes all environment variables used by the Code Graph RAG
application and how to configure them for different deployment scenarios.

## Quick Start

1. **Copy the template file:**
   ```bash
   cp .env.template .env
   ```

2. **Edit the `.env` file with your actual values**

3. **Start the application:**
   ```bash
   # Development
   npm run dev

   # Production
   npm run prod

   # Docker
   npm run docker:setup
   ```

## Required Environment Variables

These variables MUST be set for the application to function properly:

### Repository Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `REPO_URI` | Git repository URL to analyze | `git@github.com:your-org/your-repo.git` |
| `HOME` | Home directory path | `/home/username` or `/root` |

### AI Service API Keys

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Generative AI API key | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | [Anthropic Console](https://console.anthropic.com/) |
| `CO_API_KEY` | Cohere API key | [Cohere Dashboard](https://dashboard.cohere.ai/api-keys) |
| `PINECONE_API_KEY` | Pinecone vector database API key | [Pinecone Console](https://app.pinecone.io/) |
| `NEON_API_KEY` | Neon database API key | [Neon Console](https://console.neon.tech/) |

## Optional Environment Variables

### Git Configuration

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `GITHUB_PAT` | GitHub Personal Access Token | - | Required for private repositories |

### Application Configuration

| Variable | Description | Default | Options |
|----------|-------------|---------|---------|
| `NODE_ENV` | Node.js environment | `development` | `development`, `production`, `test` |
| `PORT` | Application server port | `8080` | Any valid port number |
| `LOG_LEVEL` | Logging level | `info` | `error`, `warn`, `info`, `debug` |
| `INDEX_FROM_SCRATCH` | Rebuild knowledge graph | `false` | `true`, `false` |

### Database Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` |
| `NEO4J_USERNAME` | Neo4j username | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j password | _(empty)_ |
| `DATABASE_URL` | PostgreSQL connection URL | - |

### Security Configuration

| Variable | Description | Default | Production Recommendation |
|----------|-------------|---------|---------------------------|
| `CORS_ORIGIN` | CORS allowed origins | `*` | Your frontend domain |
| `RATE_LIMIT_MAX` | Max requests per window | `100` | Adjust based on usage |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | `900000` (15 min) | Keep or adjust |

### Development Configuration

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `DEBUG` | Debug logging patterns | _(empty)_ | `graphsense:*` for all debug logs |
| `WATCH_FILES` | Enable file watching | `true` | Development only |
| `HEALTH_CHECK_TIMEOUT` | Health check timeout (ms) | `5000` | - |

## Environment Setup by Deployment Method

### Local Development

```bash
# Copy template
cp .env.template .env

# Edit .env with your values
nano .env

# Start development server
npm run dev
```

**Minimal `.env` for development:**
```env
REPO_URI=git@github.com:your-org/your-repo.git
HOME=/home/username
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
CO_API_KEY=your-key-here
PINECONE_API_KEY=your-key-here
NEON_API_KEY=your-key-here
NODE_ENV=development
LOG_LEVEL=debug
```

### Docker Development

```bash
# Set up Docker environment
npm run docker:setup

# Or manually with docker-compose
docker-compose up -d
```

**Required for Docker:**
- All the same variables as local development
- SSH keys mounted for Git access: `~/.ssh:/root/.ssh:ro`

### Production Deployment

**Environment variables can be set via:**

1. **System environment variables:**
   ```bash
   export GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
   export ANTHROPIC_API_KEY="your-key-here"
   # ... other variables
   ```

2. **`.env` file** (not recommended for production secrets)

3. **Docker environment variables:**
   ```yaml
   environment:
     - GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY}
     - NODE_ENV=production
   ```

4. **Kubernetes secrets/configmaps:**
   ```yaml
   env:
     - name: GOOGLE_GENERATIVE_AI_API_KEY
       valueFrom:
         secretKeyRef:
           name: api-keys
           key: google-ai-key
   ```

**Production-specific settings:**
```env
NODE_ENV=production
LOG_LEVEL=info
DEBUG=
CORS_ORIGIN=https://your-frontend-domain.com
RATE_LIMIT_MAX=1000
```

## Validation and Troubleshooting

### Environment Validation

The application automatically validates required environment variables on startup:

```bash
# Check environment configuration
npm run env:check

# Check application health
npm run health
```

### Common Issues

1. **Missing API Keys:**
   ```
   ❌ Missing required environment variables:
      - GOOGLE_GENERATIVE_AI_API_KEY
   ```
   **Solution:** Set the missing environment variables in your `.env` file.

2. **Git Access Issues:**
   ```
   Error: Repository clone failed
   ```
   **Solution:** Ensure `GITHUB_PAT` is set for private repos, or SSH keys are configured.

3. **Database Connection Issues:**
   ```
   Error: Neo4j connection failed
   ```
   **Solution:** Check `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` settings.

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
# Enable all debug logs
export DEBUG=graphsense:*

# Enable specific module debug logs
export DEBUG=graphsense:db,graphsense:api

# Start with debug logging
npm run dev
```

## API Key Management

### Getting API Keys

1. **Google Generative AI:**
   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create a new API key
   - Copy and store securely

2. **Anthropic Claude:**
   - Visit [Anthropic Console](https://console.anthropic.com/)
   - Navigate to API Keys
   - Create a new key

3. **Cohere:**
   - Visit [Cohere Dashboard](https://dashboard.cohere.ai/api-keys)
   - Generate a new API key

4. **Pinecone:**
   - Visit [Pinecone Console](https://app.pinecone.io/)
   - Go to API Keys section
   - Create a new key

5. **Neon:**
   - Visit [Neon Console](https://console.neon.tech/)
   - Navigate to API Keys
   - Generate a new key

### Key Rotation

Implement a regular key rotation schedule:

1. **Monthly:** Rotate development keys
2. **Quarterly:** Rotate production keys
3. **Immediately:** Rotate if compromised

## Monitoring and Alerts

Set up monitoring for:

- API key usage and quotas
- Application health checks
- Database connections
- Error rates and response times

Example health check:
```bash
curl -f http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "production",
  "port": 8080
}
```

## Support

For issues with environment configuration:

1. Check this documentation
2. Validate your `.env` file against `.env.template`
3. Run `npm run env:check` to validate configuration
4. Check application logs for specific error messages
5. Ensure all required services (Neo4j, databases) are running

## Template Files

- `.env.template` - Complete environment variable template
- `docker-compose.yml` - Docker environment configuration
- `scripts/` - Environment setup and management scripts
