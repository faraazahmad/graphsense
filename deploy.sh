#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
DEFAULT_BASE_PORT=8080
DEFAULT_POSTGRES_PORT=5432
DEFAULT_NEO4J_HTTP_PORT=7474
DEFAULT_NEO4J_BOLT_PORT=7687

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
    --env-file <file>                  Environment file to use
    --github-pat <token>               GitHub Personal Access Token
    --google-api-key <key>             Google Generative AI API Key
    --anthropic-api-key <key>          Anthropic API Key
    --rebuild                          Force rebuild of the application image

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

# Find available base port where all required ports are free
find_available_port_set() {
    local base_port=${1:-$DEFAULT_BASE_PORT}
    local port=$base_port

    while true; do
        # Check if all required ports are available
        local app_port=$port
        local postgres_port=$((port + 100))
        local neo4j_http_port=$((port + 200))
        local neo4j_bolt_port=$((port + 201))

        # Check if any of the required ports are in use
        if netstat -an 2>/dev/null | grep -q ":$app_port " || \
           netstat -an 2>/dev/null | grep -q ":$postgres_port " || \
           netstat -an 2>/dev/null | grep -q ":$neo4j_http_port " || \
           netstat -an 2>/dev/null | grep -q ":$neo4j_bolt_port "; then
            # At least one port is in use, try next set
            ((port += 10))  # Skip by 10 to avoid conflicts
        else
            # All ports are available
            break
        fi

        # Safety check to avoid infinite loop
        if [[ $port -gt 65000 ]]; then
            log_error "Unable to find available port set starting from $base_port"
            exit 1
        fi
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
    local base_port=$3
    local env_file=$4
    local github_pat=$5
    local google_api_key=$6
    local anthropic_api_key=$7
    local rebuild=$8

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
    # if instance_exists "$instance_name"; then
    #     log_error "Instance '$instance_name' already exists. Use 'remove' command first."
    #     exit 1
    # fi

    # Get available ports (find a base port where all required ports are free)
    local app_port=$(find_available_port_set ${base_port:-$DEFAULT_BASE_PORT})
    local postgres_port=$((app_port + 100))
    local neo4j_http_port=$((app_port + 200))
    local neo4j_bolt_port=$((app_port + 201))

    # Create temporary environment file
    local temp_env=$(mktemp)
    cat > "$temp_env" << EOF
# Repository Configuration
REPO_PATH=$repo_path
GITHUB_PAT=${github_pat}

# API Keys
GOOGLE_GENERATIVE_AI_API_KEY=${google_api_key}
ANTHROPIC_API_KEY=${anthropic_api_key}

# Port Configuration
PORT=$app_port
POSTGRES_PORT=$postgres_port
NEO4J_HTTP_PORT=$neo4j_http_port
NEO4J_BOLT_PORT=$neo4j_bolt_port

# Database Configuration
POSTGRES_DB=${instance_name//-/_}_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

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

    # Add custom env file if provided
    if [[ -n "$env_file" && -f "$env_file" ]]; then
        cat "$env_file" >> "$temp_env"
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

    # Build image if rebuild flag is set
    if [[ "$rebuild" == "true" ]]; then
        log_info "Rebuilding application image..."
        docker-compose build --no-cache
    fi

    # Deploy the instance
    log_info "Starting services for instance: $instance_name"

    # Ensure we're using the correct project name and check for conflicts
    export COMPOSE_PROJECT_NAME="$instance_name"

    if ! docker-compose \
        -f docker-compose.yml \
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
        local healthy_count=$(COMPOSE_PROJECT_NAME="$instance_name" docker-compose ps --services | wc -l)
        local running_healthy=$(COMPOSE_PROJECT_NAME="$instance_name" docker-compose ps | grep -c "healthy\|Up" || echo "0")

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
        COMPOSE_PROJECT_NAME="$instance_name" docker-compose ps
    fi

    # Cleanup temporary files
    rm -f "$temp_env" "$compose_override"

    log_success "Instance '$instance_name' deployed successfully!"
    log_info "Access URLs:"
    log_info "  Application: http://localhost:$app_port"
    log_info "  Neo4j Browser: http://localhost:$neo4j_http_port"
    log_info "  PostgreSQL: localhost:$postgres_port"
}

# Stop instance
stop_instance() {
    local instance_name=$1

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    log_info "Stopping instance: $instance_name"
    if ! COMPOSE_PROJECT_NAME="$instance_name" docker-compose stop; then
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
    if ! COMPOSE_PROJECT_NAME="$instance_name" docker-compose start; then
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
    if ! COMPOSE_PROJECT_NAME="$instance_name" docker-compose down -v --remove-orphans; then
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
        COMPOSE_PROJECT_NAME="$instance_name" docker-compose logs -f "$service"
    else
        COMPOSE_PROJECT_NAME="$instance_name" docker-compose logs -f
    fi
}

# Show status
show_status() {
    local instance_name=$1

    if ! instance_exists "$instance_name"; then
        log_error "Instance '$instance_name' does not exist."
        exit 1
    fi

    log_info "Status for instance: $instance_name"

    # Show docker-compose status
    COMPOSE_PROJECT_NAME="$instance_name" docker-compose ps

    echo
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
    log_info "Available port ranges starting from common bases:"
    for base_port in 8080 8090 8100 8110 8120; do
        local app_port=$base_port
        local postgres_port=$((base_port + 100))
        local neo4j_http_port=$((base_port + 200))
        local neo4j_bolt_port=$((base_port + 201))

        local conflicts=""
        if netstat -an 2>/dev/null | grep -q ":$app_port "; then
            conflicts="$conflicts APP:$app_port"
        fi
        if netstat -an 2>/dev/null | grep -q ":$postgres_port "; then
            conflicts="$conflicts PG:$postgres_port"
        fi
        if netstat -an 2>/dev/null | grep -q ":$neo4j_http_port "; then
            conflicts="$conflicts NEO4J-HTTP:$neo4j_http_port"
        fi
        if netstat -an 2>/dev/null | grep -q ":$neo4j_bolt_port "; then
            conflicts="$conflicts NEO4J-BOLT:$neo4j_bolt_port"
        fi

        if [[ -z "$conflicts" ]]; then
            echo "  Base $base_port: ✅ AVAILABLE (App:$app_port, PG:$postgres_port, Neo4j:$neo4j_http_port/$neo4j_bolt_port)"
        else
            echo "  Base $base_port: ❌ CONFLICTS -$conflicts"
        fi
    done

    echo
    log_info "Next available base port:"
    local next_port=$(find_available_port_set 8080)
    echo "  Recommended base port: $next_port"
    echo "  Ports that will be used:"
    echo "    - Application: $next_port"
    echo "    - PostgreSQL: $((next_port + 100))"
    echo "    - Neo4j HTTP: $((next_port + 200))"
    echo "    - Neo4j Bolt: $((next_port + 201))"
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
BASE_PORT=""
ENV_FILE=""
GITHUB_PAT=""
GOOGLE_API_KEY=""
ANTHROPIC_API_KEY=""
REBUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        deploy|stop|start|remove|list|logs|status|debug|cleanup)
            COMMAND=$1
            shift
            ;;
        --port)
            BASE_PORT=$2
            shift 2
            ;;
        --env-file)
            ENV_FILE=$2
            shift 2
            ;;
        --github-pat)
            GITHUB_PAT=$2
            shift 2
            ;;
        --google-api-key)
            GOOGLE_API_KEY=$2
            shift 2
            ;;
        --anthropic-api-key)
            ANTHROPIC_API_KEY=$2
            shift 2
            ;;
        --rebuild)
            REBUILD=true
            shift
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
            elif [[ -z "$INSTANCE_NAME" && ("$COMMAND" == "deploy" || "$COMMAND" == "stop" || "$COMMAND" == "start" || "$COMMAND" == "remove" || "$COMMAND" == "logs" || "$COMMAND" == "status") ]]; then
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
        deploy_instance "$REPO_PATH" "$INSTANCE_NAME" "$BASE_PORT" "$ENV_FILE" "$GITHUB_PAT" "$GOOGLE_API_KEY" "$ANTHROPIC_API_KEY" "$REBUILD"
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
