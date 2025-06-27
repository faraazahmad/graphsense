#!/bin/bash

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
DEFAULT_APP_PORT=8080

# Help function
show_help() {
    cat << EOF
GraphSense Multi-Instance Deployment Script

USAGE:
    $0 <command> [options]

COMMANDS:
    deploy <repo_path> [instance_name]  Deploy a new instance for the given repository
    stop <instance_name>               Stop an instance
    start <instance_name>              Start a stopped instance
    remove <instance_name>             Remove an instance completely
    list                               List all running instances
    logs <instance_name> [service]     Show logs for an instance
    status <instance_name>             Show status of an instance
    debug                              Show port usage and debug information
    cleanup                            Remove all stopped containers and unused volumes

OPTIONS:
    --port <port>                      Base port for the instance (default: auto-assigned)
    --co-api-key <key>                 Cohere API key for the application
    --anthropic-api-key <key>          Anthropic API key for the application

EXAMPLES:
    $0 deploy /path/to/local/repository my-analysis
    $0 deploy /home/user/projects/my-repo my-analysis --port 8090
    $0 stop my-analysis
    $0 logs my-analysis app
    $0 debug
    $0 remove my-analysis

EOF
}

# Utility functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get next available port
get_next_port() {
    local base_port=$1
    local port=$base_port
    while netstat -an 2>/dev/null | grep -q ":$port "; do
        ((port++))
    done
    echo $port
}

# Generate instance name from repo path
generate_instance_name() {
    local repo_path=$1
    # Extract repo name from path and sanitize it
    local repo_name=$(basename "$repo_path" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
    echo "graphsense-$repo_name"
}

# Check if instance exists
instance_exists() {
    local instance_name=$1
    # Check if any containers exist for this project
    if docker ps -a --filter "label=com.docker.compose.project=$instance_name" --format "{{.Names}}" | grep -q .; then
        return 0
    else
        return 1
    fi
}

# Deploy new instance
deploy_instance() {
    local repo_path=$1
    local instance_name=$2
    local app_port=$3
    local co_api_key=$4
    local anthropic_api_key=$5

    # Validate repo path
    if [[ ! -d "$repo_path" ]]; then
        log_error "Repository path does not exist: $repo_path"
        exit 1
    fi

    # Convert to absolute path
    repo_path=$(realpath "$repo_path")

    # Generate instance name if not provided
    if [[ -z "$instance_name" ]]; then
        instance_name=$(generate_instance_name "$repo_path")
    fi

    # Sanitize instance name
    instance_name=$(echo "$instance_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

    log_info "Deploying instance: $instance_name for repository: $repo_path"

    # Check if instance already exists
    if instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' already exists. Use 'remove' command first."
        exit 1
    fi

    # Get available port for app
    if [[ -z "$app_port" ]]; then
        app_port=$(get_next_port $DEFAULT_APP_PORT)
    fi

    # Create temporary environment file
    local temp_env=$(mktemp)
    cat > "$temp_env" << EOF
# Repository Configuration
REPO_PATH=$repo_path

# Port Configuration
PORT=$app_port

# Neo4j Configuration
NEO4J_AUTH=none
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=

# Application Configuration
NODE_ENV=production
LOG_LEVEL=info
INDEX_FROM_SCRATCH=true

# Security Configuration
CORS_ORIGIN=*
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000
EOF

    # Add API keys if provided
    if [[ -n "$co_api_key" ]]; then
        echo "CO_API_KEY=$co_api_key" >> "$temp_env"
    fi

    if [[ -n "$anthropic_api_key" ]]; then
        echo "ANTHROPIC_API_KEY=$anthropic_api_key" >> "$temp_env"
    fi

    # Create instance-specific docker-compose override
    local compose_override=$(mktemp)
    cat > "$compose_override" << EOF
version: "3.8"

services:
  postgres:
    container_name: ${instance_name}-postgres
    volumes:
      - ${instance_name}_postgres_data:/var/lib/postgresql/data
    networks:
      - ${instance_name}-network

  neo4j:
    container_name: ${instance_name}-neo4j
    volumes:
      - ${instance_name}_neo4j_data:/data
      - ${instance_name}_neo4j_logs:/logs
      - ${instance_name}_neo4j_plugins:/plugins
      - ${instance_name}_neo4j_conf:/conf
    networks:
      - ${instance_name}-network

  app:
    container_name: ${instance_name}-app
    volumes:
      - ${instance_name}_app_repos:/app/.graphsense
      - ${repo_path}:/home/repo:ro
    ports:
      - "${app_port}:8080"
    networks:
      - ${instance_name}-network
    environment:
      - POSTGRES_URL=postgresql://postgres:postgres@${instance_name}-postgres:5432/\${POSTGRES_DB}
      - NEO4J_URI=bolt://${instance_name}-neo4j:7687
      - LOCAL_REPO_PATH=/home/repo

networks:
  ${instance_name}-network:
    driver: bridge

volumes:
  ${instance_name}_postgres_data:
    name: ${instance_name}_postgres_data
  ${instance_name}_neo4j_data:
    name: ${instance_name}_neo4j_data
  ${instance_name}_neo4j_logs:
    name: ${instance_name}_neo4j_logs
  ${instance_name}_neo4j_plugins:
    name: ${instance_name}_neo4j_plugins
  ${instance_name}_neo4j_conf:
    name: ${instance_name}_neo4j_conf
  ${instance_name}_app_repos:
    name: ${instance_name}_app_repos
EOF

    # Rebuild image
    log_info "Rebuilding application image..."
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" build --no-cache

    # Deploy the instance
    log_info "Starting services for instance: $instance_name"

    # Ensure we're using the correct project name and check for conflicts
    export COMPOSE_PROJECT_NAME="$instance_name"

    if ! docker-compose \
        -f "$SCRIPT_DIR/docker-compose.yml" \
        -f "$compose_override" \
        --env-file "$temp_env" \
        up -d; then
        log_error "Failed to deploy instance $instance_name"
        rm -f "$temp_env" "$compose_override"
        exit 1
    fi

    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    local max_attempts=60
    local attempt=0
    local all_healthy=false

    while [[ $attempt -lt $max_attempts ]]; do
        # Check if all services are healthy
        local healthy_count=$(COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" ps --services | wc -l)
        local running_healthy=$(COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" ps | grep -c "healthy\|Up" || echo "0")

        if [[ $running_healthy -ge $healthy_count ]]; then
            all_healthy=true
            break
        fi

        sleep 5
        ((attempt++))
        log_info "Waiting for health checks... ($attempt/$max_attempts)"
    done

    if [[ "$all_healthy" != "true" ]]; then
        log_warning "Not all services became healthy within timeout, but continuing..."
        COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" ps
    fi

    # Cleanup temporary files
    rm -f "$temp_env" "$compose_override"

    log_success "Instance '$instance_name' deployed successfully!"
    log_info "Access URLs:"
    log_info "  MCP Server: http://localhost:$app_port"
}

# Stop instance
stop_instance() {
    local instance_name=$1

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    log_info "Stopping instance: $instance_name"
    if ! COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" stop; then
        log_error "Failed to stop instance $instance_name"
        exit 1
    fi
    log_success "Instance '$instance_name' stopped."
}

# Start instance
start_instance() {
    local instance_name=$1

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    log_info "Starting instance: $instance_name"
    if ! COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" start; then
        log_error "Failed to start instance $instance_name"
        exit 1
    fi
    log_success "Instance '$instance_name' started."
}

# Remove instance
remove_instance() {
    local instance_name=$1

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    log_warning "This will permanently remove instance '$instance_name' and all its data."
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled."
        exit 0
    fi

    log_info "Removing instance: $instance_name"

    # Stop and remove containers
    if ! COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" down -v --remove-orphans; then
        log_warning "Failed to cleanly remove instance with docker-compose, trying manual cleanup..."

        # Manual cleanup as fallback
        docker ps -a --filter "label=com.docker.compose.project=$instance_name" -q | xargs -r docker rm -f
    fi

    # Remove associated volumes
    log_info "Removing associated volumes..."
    docker volume ls -q | grep "^${instance_name}_" | xargs -r docker volume rm 2>/dev/null || true

    log_success "Instance '$instance_name' removed."
}

# List instances
list_instances() {
    log_info "GraphSense Instances:"
    echo

    # Get all compose projects that start with graphsense-
    local projects=$(docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" | grep "graphsense-" | sort)

    if [[ -z "$projects" ]]; then
        log_info "No instances found."
        return
    fi

    echo "$projects"
}

# Show logs
show_logs() {
    local instance_name=$1
    local service=$2

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    if [[ -n "$service" ]]; then
        COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" logs -f "$service"
    else
        COMPOSE_PROJECT_NAME="$instance_name" docker-compose -f "$SCRIPT_DIR/docker-compose.yml" logs -f
    fi
}

# Show status
show_status() {
    local instance_name=$1

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    log_info "Container details:"
    docker ps --filter "label=com.docker.compose.project=$instance_name" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

# Debug port usage and conflicts
debug_ports() {
    log_info "Port Usage Debug Information"
    echo

    log_info "Currently listening ports (GraphSense related):"
    netstat -an 2>/dev/null | grep LISTEN | grep -E ":(808[0-9]|5[0-9][0-9][0-9]|74[0-9][0-9]|76[0-9][0-9])" | sort -n -k4 -t: || echo "No GraphSense ports detected"

    echo
    log_info "Docker containers with port mappings:"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}" | grep -E "(graphsense|neo4j|postgres)" || echo "No GraphSense containers running"

    echo
    log_info "GraphSense Docker Compose projects:"
    docker ps --filter "label=com.docker.compose.project" --format "table {{.Names}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Ports}}" | grep graphsense || echo "No GraphSense compose projects detected"

    echo
    log_info "Available app ports starting from common bases:"
    for app_port in 8080 8090 8100 8110 8120; do
        if netstat -an 2>/dev/null | grep -q ":$app_port "; then
            echo "  Port $app_port: ❌ IN USE"
        else
            echo "  Port $app_port: ✅ AVAILABLE"
        fi
    done

    echo
    log_info "Next available app port:"
    local next_port=$(get_next_port 8080)
    echo "  Recommended app port: $next_port"
}

# Cleanup
cleanup() {
    log_info "Cleaning up stopped containers and unused volumes..."
    docker container prune -f
    docker volume prune -f
    log_success "Cleanup completed."
}

# Parse command line arguments
COMMAND=""
REPO_PATH=""
INSTANCE_NAME=""
APP_PORT=""
CO_API_KEY=""
ANTHROPIC_API_KEY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        deploy|stop|start|remove|list|logs|status|debug|cleanup)
            COMMAND=$1
            shift
            ;;
        --port)
            APP_PORT=$2
            shift 2
            ;;
        --co-api-key)
            CO_API_KEY=$2
            shift 2
            ;;
        --anthropic-api-key)
            ANTHROPIC_API_KEY=$2
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            if [[ -z "$REPO_PATH" && "$COMMAND" == "deploy" ]]; then
                REPO_PATH=$1
            elif [[ -z "$INSTANCE_NAME" && ("$COMMAND" == "deploy" || "$COMMAND" == "stop" || "$COMMAND" == "start" || "$COMMAND" == "remove" || "$COMMAND" == "logs" || "$COMMAND" == "status" || "$COMMAND" == "debug-connectivity") ]]; then
                INSTANCE_NAME=$1
            else
                log_error "Unexpected argument: $1"
                show_help
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate command
if [[ -z "$COMMAND" ]]; then
    log_error "No command specified."
    show_help
    exit 1
fi

# Execute command
case $COMMAND in
    deploy)
        if [[ -z "$REPO_PATH" ]]; then
            log_error "Repository path is required for deploy command."
            exit 1
        fi
        deploy_instance "$REPO_PATH" "$INSTANCE_NAME" "$APP_PORT" "$CO_API_KEY" "$ANTHROPIC_API_KEY"
        ;;
    stop)
        if [[ -z "$INSTANCE_NAME" ]]; then
            log_error "Instance name is required for stop command."
            exit 1
        fi
        stop_instance "$INSTANCE_NAME"
        ;;
    start)
        if [[ -z "$INSTANCE_NAME" ]]; then
            log_error "Instance name is required for start command."
            exit 1
        fi
        start_instance "$INSTANCE_NAME"
        ;;
    remove)
        if [[ -z "$INSTANCE_NAME" ]]; then
            log_error "Instance name is required for remove command."
            exit 1
        fi
        remove_instance "$INSTANCE_NAME"
        ;;
    list)
        list_instances
        ;;
    logs)
        if [[ -z "$INSTANCE_NAME" ]]; then
            log_error "Instance name is required for logs command."
            exit 1
        fi
        show_logs "$INSTANCE_NAME" "$2"
        ;;
    status)
        if [[ -z "$INSTANCE_NAME" ]]; then
            log_error "Instance name is required for status command."
            exit 1
        fi
        show_status "$INSTANCE_NAME"
        ;;
    debug)
        debug_ports
        ;;
    cleanup)
        cleanup
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
