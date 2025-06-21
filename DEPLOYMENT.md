# GraphSense Multi-Instance Deployment Guide

This guide explains how to deploy and manage multiple isolated instances of GraphSense, each analyzing different repositories.

## Prerequisites

- Docker and Docker Compose installed
- At least 4GB RAM per instance
- Network ports available (script auto-assigns ports)
- API keys for AI services (Google Generative AI, Anthropic, etc.)

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone <your-graphsense-repo>
   cd code-graph-rag
   ```

2. **Make the deployment script executable:**
   ```bash
   chmod +x deploy.sh
   ```

3. **Deploy your first instance:**
   ```bash
   ./deploy.sh deploy /path/to/your/local/repository my-analysis \
     --google-api-key "your-google-api-key" \
     --anthropic-api-key "your-anthropic-api-key"
   ```

## Usage

### Deploy a New Instance

```bash
./deploy.sh deploy <repo_path> [instance_name] [options]
```

**Examples:**
```bash
# Basic deployment with auto-generated name
./deploy.sh deploy /home/user/projects/react

# Custom instance name
./deploy.sh deploy /home/user/projects/typescript my-ts-analysis

# Specify custom port and API keys
./deploy.sh deploy /path/to/local/repo my-analysis \
  --port 8090 \
  --google-api-key "your-key" \
  --anthropic-api-key "your-key"

# Use environment file
./deploy.sh deploy /path/to/local/repo my-analysis \
  --env-file .env.custom
```

### Manage Instances

```bash
# List all running instances
./deploy.sh list

# Stop an instance
./deploy.sh stop my-analysis

# Start a stopped instance
./deploy.sh start my-analysis

# View logs
./deploy.sh logs my-analysis        # All services
./deploy.sh logs my-analysis app    # Just the app
./deploy.sh logs my-analysis postgres

# Check instance status
./deploy.sh status my-analysis

# Remove instance completely (with confirmation)
./deploy.sh remove my-analysis

# Clean up unused containers and volumes
./deploy.sh cleanup
```

## Configuration

### Environment Variables

The script supports several configuration options:

| Option | Description | Example |
|--------|-------------|---------|
| `--port` | Base port for the instance | `--port 8090` |
| `--env-file` | Custom environment file | `--env-file .env.prod` |
| `--github-pat` | GitHub Personal Access Token | `--github-pat ghp_xxx` |
| `--google-api-key` | Google Generative AI API Key | `--google-api-key your-key` |
| `--anthropic-api-key` | Anthropic API Key | `--anthropic-api-key your-key` |
| `--rebuild` | Force rebuild of application image | `--rebuild` |

### Port Assignment

The script automatically assigns ports to avoid conflicts:
- **Application**: Base port (default: 8080)
- **PostgreSQL**: Base port + 100
- **Neo4j HTTP**: Base port + 200  
- **Neo4j Bolt**: Base port + 201

### Environment Files

Create custom `.env` files for different configurations:

```bash
# .env.development
NODE_ENV=development
LOG_LEVEL=debug
INDEX_FROM_SCRATCH=true

# .env.production
NODE_ENV=production
LOG_LEVEL=info
INDEX_FROM_SCRATCH=false
CORS_ORIGIN=https://your-domain.com
```

## Instance Isolation

Each instance is completely isolated:
- **Separate Docker networks**: No cross-instance communication
- **Unique volumes**: Independent data storage
- **Different ports**: No port conflicts
- **Isolated databases**: Each instance has its own PostgreSQL and Neo4j

## Example Workflows

### Analyzing Multiple Repositories

```bash
# Deploy instances for different projects
./deploy.sh deploy /home/user/projects/react react-analysis
./deploy.sh deploy /home/user/projects/vscode vscode-analysis  
./deploy.sh deploy /home/user/projects/node nodejs-analysis

# Check all instances
./deploy.sh list

# Access each analysis
# React: http://localhost:8080
# VSCode: http://localhost:8081  
# Node.js: http://localhost:8082
```

### Development vs Production

```bash
# Development instance
./deploy.sh deploy /path/to/local/repo dev-analysis \
  --env-file .env.development \
  --port 3000

# Production instance  
./deploy.sh deploy /path/to/local/repo prod-analysis \
  --env-file .env.production \
  --port 8080
```

### Local Repository Analysis

```bash
# Analyze any local repository (public or private)
./deploy.sh deploy /path/to/company/private-repo company-analysis \
  --google-api-key "your-google-key" \
  --anthropic-api-key "your-anthropic-key"

# The repository must exist locally and be accessible
ls -la /path/to/company/private-repo  # Verify the repository exists
```

## Monitoring and Troubleshooting

### Health Checks

Each service includes health checks:
```bash
# Check if instance is healthy
./deploy.sh status my-analysis

# View detailed logs
./deploy.sh logs my-analysis app
```

### Common Issues

1. **Port conflicts**: The script auto-assigns ports, but you can specify custom ones
2. **Memory issues**: Each instance needs ~4GB RAM
3. **API rate limits**: Monitor your API usage across instances
4. **Disk space**: Each instance stores repository data and analysis results

### Resource Usage

Monitor resource usage:
```bash
# Check Docker resource usage
docker stats

# Check specific instance
docker stats $(docker ps --filter "name=my-analysis" --format "{{.Names}}")
```

## Advanced Usage

### Batch Deployment

Create a script to deploy multiple instances:

```bash
#!/bin/bash
repos=(
  "/home/user/projects/react"
  "/home/user/projects/typescript"
  "/home/user/projects/node"
)

for repo in "${repos[@]}"; do
  name=$(basename "$repo")
  ./deploy.sh deploy "$repo" "$name-analysis" \
    --google-api-key "$GOOGLE_API_KEY" \
    --anthropic-api-key "$ANTHROPIC_API_KEY"
done
```

### Backup and Restore

```bash
# Backup instance data
docker run --rm -v my-analysis_postgres_data:/data -v $(pwd):/backup ubuntu tar czf /backup/my-analysis-postgres.tar.gz /data

# List all volumes for an instance
docker volume ls | grep my-analysis
```

### Load Balancing

For production deployments, consider:
- Nginx reverse proxy for load balancing
- Docker Swarm or Kubernetes for orchestration
- External managed databases for better performance

## Security Considerations

- Use environment files for sensitive data
- Restrict CORS origins in production
- Use strong database passwords
- Consider network isolation for production
- Regularly update base images

## Performance Tips

- Allocate sufficient resources per instance
- Use SSD storage for better database performance
- Monitor API rate limits across instances
- Consider caching strategies for frequently analyzed repositories
- Use `INDEX_FROM_SCRATCH=false` after initial analysis
- Ensure local repositories are up-to-date before analysis
- Consider using git hooks to trigger re-analysis on repository updates

## Support

For issues with the deployment script:
1. Check the logs: `./deploy.sh logs <instance-name>`
2. Verify port availability: `netstat -an | grep <port>`
3. Check Docker resources: `docker system df`
4. Review instance status: `./deploy.sh status <instance-name>`
