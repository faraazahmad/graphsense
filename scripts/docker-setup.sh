#!/bin/bash

# Docker environment setup script for Code Graph RAG
# This script helps set up and manage the Docker environment

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Code Graph RAG Docker Environment Setup${NC}"
echo

# Function to check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker is not installed${NC}"
        echo -e "${YELLOW}💡 Please install Docker: https://docs.docker.com/get-docker/${NC}"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo -e "${RED}❌ Docker Compose is not installed${NC}"
        echo -e "${YELLOW}💡 Please install Docker Compose: https://docs.docker.com/compose/install/${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Docker and Docker Compose are installed${NC}"
}

# Function to check if .env file exists and has required variables
check_env_file() {
    if [ ! -f ".env" ]; then
        echo -e "${YELLOW}⚠️  .env file not found${NC}"

        if [ -f ".env.example" ]; then
            echo -e "${BLUE}📋 Creating .env file from template...${NC}"
            cp .env.example .env
            echo -e "${GREEN}✅ .env file created from template${NC}"
            echo
            echo -e "${YELLOW}⚠️  IMPORTANT: Please edit .env file with your actual values${NC}"
            echo -e "${BLUE}Required variables for Docker deployment:${NC}"
            echo -e "   - ANTHROPIC_API_KEY"
            echo -e "   - CO_API_KEY"
            echo
            read -p "Press Enter to continue after editing .env file, or Ctrl+C to exit..."
        else
            echo -e "${RED}❌ .env.example file not found${NC}"
            exit 1
        fi
    fi

    echo -e "${GREEN}✅ .env file found${NC}"
}

# Function to validate Docker environment
validate_docker_env() {
    echo -e "${BLUE}🔍 Validating Docker environment...${NC}"

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ Docker daemon is not running${NC}"
        echo -e "${YELLOW}💡 Please start Docker and try again${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Docker daemon is running${NC}"
}

# Function to create necessary directories
create_directories() {
    echo -e "${BLUE}📁 Creating necessary directories...${NC}"

    # Create SSH directory for Git access
    mkdir -p ~/.ssh

    # Create logs directory
    mkdir -p logs

    echo -e "${GREEN}✅ Directories created${NC}"
}

# Function to build Docker images
build_images() {
    echo -e "${BLUE}🔨 Building Docker images...${NC}"

    # Build the main application image
    docker-compose build app

    echo -e "${GREEN}✅ Docker images built successfully${NC}"
}

# Function to start services
start_services() {
    echo -e "${BLUE}🚀 Starting Docker services...${NC}"

    # Start all services
    docker-compose up -d

    echo -e "${GREEN}✅ Docker services started${NC}"
    echo
    echo -e "${BLUE}📊 Service Status:${NC}"
    docker-compose ps
}

# Function to check service health
check_health() {
    echo -e "${BLUE}🏥 Checking service health...${NC}"

    # Wait for Neo4j to be ready
    echo -e "${YELLOW}⏳ Waiting for Neo4j to be ready...${NC}"
    docker-compose exec neo4j cypher-shell "RETURN 1" || {
        echo -e "${RED}❌ Neo4j failed to start${NC}"
        echo -e "${YELLOW}💡 Check logs: docker-compose logs neo4j${NC}"
        exit 1
    }
    echo -e "${GREEN}✅ Neo4j is ready${NC}"

    # Wait for application to be ready
    echo -e "${YELLOW}⏳ Waiting for application to be ready...${NC}"
    curl -f http://localhost:${PORT:-8080}/health || {
        echo -e "${RED}❌ Application failed to start within 60 seconds${NC}"
        echo -e "${YELLOW}💡 Check logs: docker-compose logs app${NC}"
        exit 1
    }
    echo -e "${GREEN}✅ Application is ready${NC}"
}

# Function to show service information
show_info() {
    echo
    echo -e "${GREEN}🎉 Docker environment is ready!${NC}"
    echo
    echo -e "${BLUE}📋 Service Information:${NC}"
    echo -e "   Application: http://localhost:${PORT:-8080}"
    echo -e "   Health Check: http://localhost:${PORT:-8080}/health"
    echo -e "   Neo4j Browser: http://localhost:${NEO4J_HTTP_PORT:-7474}"
    echo -e "   Neo4j Bolt: bolt://localhost:${NEO4J_BOLT_PORT:-7687}"
    echo
    echo -e "${BLUE}🔧 Useful Commands:${NC}"
    echo -e "   View logs: docker-compose logs -f"
    echo -e "   Stop services: docker-compose stop"
    echo -e "   Restart services: docker-compose restart"
    echo -e "   Remove everything: docker-compose down -v"
    echo -e "   Rebuild and restart: docker-compose up --build -d"
    echo
    echo -e "${BLUE}🐛 Debugging:${NC}"
    echo -e "   App logs: docker-compose logs -f app"
    echo -e "   Neo4j logs: docker-compose logs -f neo4j"
    echo -e "   Execute in app container: docker-compose exec app sh"
    echo -e "   Execute in neo4j container: docker-compose exec neo4j bash"
}

# Function to stop services
stop_services() {
    echo -e "${YELLOW}🛑 Stopping Docker services...${NC}"
    docker-compose stop
    echo -e "${GREEN}✅ Services stopped${NC}"
}

# Function to clean up everything
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up Docker environment...${NC}"
    echo -e "${RED}⚠️  This will remove all containers, volumes, and data${NC}"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose down -v --remove-orphans
        docker system prune -f
        echo -e "${GREEN}✅ Cleanup completed${NC}"
    else
        echo -e "${YELLOW}Cleanup cancelled${NC}"
    fi
}

# Main function
main() {
    case "${1:-setup}" in
        setup)
            check_docker
            check_env_file
            validate_docker_env
            create_directories
            build_images
            start_services
            check_health
            show_info
            ;;
        start)
            check_docker
            validate_docker_env
            start_services
            check_health
            show_info
            ;;
        stop)
            stop_services
            ;;
        restart)
            stop_services
            start_services
            check_health
            show_info
            ;;
        rebuild)
            stop_services
            build_images
            start_services
            check_health
            show_info
            ;;
        cleanup)
            cleanup
            ;;
        logs)
            docker-compose logs -f
            ;;
        status)
            echo -e "${BLUE}📊 Docker Services Status:${NC}"
            docker-compose ps
            echo
            echo -e "${BLUE}🏥 Health Checks:${NC}"
            curl -s http://localhost:${PORT:-8080}/health | jq . 2>/dev/null || curl -s http://localhost:${PORT:-8080}/health
            ;;
        help|*)
            echo -e "${BLUE}🐳 Code Graph RAG Docker Management${NC}"
            echo
            echo -e "${YELLOW}Usage: $0 [command]${NC}"
            echo
            echo -e "${BLUE}Commands:${NC}"
            echo -e "   setup    - Complete setup (default)"
            echo -e "   start    - Start services"
            echo -e "   stop     - Stop services"
            echo -e "   restart  - Restart services"
            echo -e "   rebuild  - Rebuild and restart services"
            echo -e "   cleanup  - Remove all containers and volumes"
            echo -e "   logs     - Show and follow logs"
            echo -e "   status   - Show service status and health"
            echo -e "   help     - Show this help message"
            echo
            echo -e "${BLUE}Examples:${NC}"
            echo -e "   $0 setup     # Complete setup and start"
            echo -e "   $0 start     # Start existing services"
            echo -e "   $0 logs      # View logs"
            echo -e "   $0 cleanup   # Clean everything"
            ;;
    esac
}

# Run main function with all arguments
main "$@"
