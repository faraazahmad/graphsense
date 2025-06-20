#!/bin/bash

# Quick Start Script for Code Graph RAG
# This script provides a complete setup and startup experience

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Make the script executable
chmod +x "$0"

echo -e "${BOLD}${BLUE}"
echo "  ╔═══════════════════════════════════════════════════════════════════╗"
echo "  ║                    Code Graph RAG Quick Start                     ║"
echo "  ║                                                                   ║"
echo "  ║  This script will help you set up and run Code Graph RAG         ║"
echo "  ║  Choose your preferred deployment method below                    ║"
echo "  ╚═══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Function to display menu
show_menu() {
    echo -e "${CYAN}🚀 Quick Start Options:${NC}"
    echo
    echo -e "${YELLOW}1)${NC} 🖥️  Local Development Setup"
    echo -e "   - Set up environment variables"
    echo -e "   - Install dependencies"
    echo -e "   - Start development server with hot reload"
    echo
    echo -e "${YELLOW}2)${NC} 🐳 Docker Development Setup"
    echo -e "   - Complete Docker environment with Neo4j"
    echo -e "   - Automatic service orchestration"
    echo -e "   - Isolated development environment"
    echo
    echo -e "${YELLOW}3)${NC} 🏭 Production Docker Deployment"
    echo -e "   - Production-ready Docker setup"
    echo -e "   - Optimized for performance and security"
    echo -e "   - Health checks and monitoring"
    echo
    echo -e "${YELLOW}4)${NC} ✅ Validate Environment Configuration"
    echo -e "   - Check all environment variables"
    echo -e "   - Validate API keys and configuration"
    echo -e "   - Get helpful setup suggestions"
    echo
    echo -e "${YELLOW}5)${NC} 📚 View Documentation"
    echo -e "   - Environment variables guide"
    echo -e "   - API key setup instructions"
    echo -e "   - Troubleshooting help"
    echo
    echo -e "${YELLOW}6)${NC} 🔧 Advanced Options"
    echo -e "   - Manual setup steps"
    echo -e "   - Custom configuration"
    echo -e "   - Development tools"
    echo
    echo -e "${YELLOW}0)${NC} ❌ Exit"
    echo
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking prerequisites...${NC}"

    local missing_tools=()

    # Check Node.js
    if ! command -v node &> /dev/null; then
        missing_tools+=("Node.js (https://nodejs.org/)")
    else
        local node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$node_version" -lt 16 ]; then
            echo -e "${YELLOW}⚠️  Node.js version $node_version detected. Recommended: 16 or higher${NC}"
        else
            echo -e "${GREEN}✅ Node.js $(node --version)${NC}"
        fi
    fi

    # Check npm
    if ! command -v npm &> /dev/null; then
        missing_tools+=("npm (comes with Node.js)")
    else
        echo -e "${GREEN}✅ npm $(npm --version)${NC}"
    fi

    # Check git
    if ! command -v git &> /dev/null; then
        missing_tools+=("Git (https://git-scm.com/)")
    else
        echo -e "${GREEN}✅ Git $(git --version | cut -d' ' -f3)${NC}"
    fi

    # Check curl
    if ! command -v curl &> /dev/null; then
        missing_tools+=("curl")
    fi

    if [ ${#missing_tools[@]} -ne 0 ]; then
        echo -e "${RED}❌ Missing required tools:${NC}"
        for tool in "${missing_tools[@]}"; do
            echo -e "${RED}   - $tool${NC}"
        done
        echo
        echo -e "${YELLOW}💡 Please install the missing tools and run this script again${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ All prerequisites satisfied${NC}"
    echo
}

# Function for local development setup
local_development_setup() {
    echo -e "${BLUE}🖥️  Setting up Local Development Environment${NC}"
    echo

    # Check for .env file
    if [ ! -f ".env" ]; then
        if [ -f ".env.template" ]; then
            echo -e "${YELLOW}📋 Creating .env file from template...${NC}"
            cp .env.template .env
            echo -e "${GREEN}✅ .env file created${NC}"
            echo
            echo -e "${YELLOW}⚠️  IMPORTANT: You need to edit the .env file with your actual API keys${NC}"
            echo -e "${BLUE}Required API keys:${NC}"
            echo -e "   - Google Generative AI API Key"
            echo -e "   - Anthropic API Key"
            echo -e "   - Cohere API Key"
            echo -e "   - Pinecone API Key"
            echo -e "   - Neon API Key"
            echo
            read -p "Press Enter after you've edited the .env file, or Ctrl+C to exit..."
        else
            echo -e "${RED}❌ .env.template file not found${NC}"
            exit 1
        fi
    fi

    # Validate environment
    echo -e "${BLUE}🔍 Validating environment configuration...${NC}"
    if node scripts/validate-env.js; then
        echo -e "${GREEN}✅ Environment validation passed${NC}"
    else
        echo -e "${RED}❌ Environment validation failed${NC}"
        echo -e "${YELLOW}💡 Please fix the issues above and try again${NC}"
        exit 1
    fi

    # Install dependencies
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"

    # Build TypeScript
    echo -e "${BLUE}🔨 Building TypeScript...${NC}"
    npm run build
    echo -e "${GREEN}✅ TypeScript compiled${NC}"

    # Start development server
    echo -e "${BLUE}🚀 Starting development server...${NC}"
    echo -e "${YELLOW}💡 The server will restart automatically when files change${NC}"
    echo -e "${YELLOW}💡 Press Ctrl+C to stop the server${NC}"
    echo

    chmod +x scripts/start-dev.sh
    ./scripts/start-dev.sh
}

# Function for Docker development setup
docker_development_setup() {
    echo -e "${BLUE}🐳 Setting up Docker Development Environment${NC}"
    echo

    # Check Docker
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

    echo -e "${GREEN}✅ Docker and Docker Compose found${NC}"

    # Check for .env file
    if [ ! -f ".env" ]; then
        if [ -f ".env.template" ]; then
            echo -e "${YELLOW}📋 Creating .env file from template...${NC}"
            cp .env.template .env
            echo -e "${GREEN}✅ .env file created${NC}"
            echo
            echo -e "${YELLOW}⚠️  IMPORTANT: You need to edit the .env file with your actual API keys${NC}"
            echo -e "${BLUE}See ENVIRONMENT.md for detailed instructions${NC}"
            echo
            read -p "Press Enter after you've edited the .env file, or Ctrl+C to exit..."
        else
            echo -e "${RED}❌ .env.template file not found${NC}"
            exit 1
        fi
    fi

    # Run Docker setup
    chmod +x scripts/docker-setup.sh
    ./scripts/docker-setup.sh setup
}

# Function for production Docker deployment
production_docker_deployment() {
    echo -e "${BLUE}🏭 Setting up Production Docker Deployment${NC}"
    echo

    echo -e "${YELLOW}⚠️  Production Deployment Checklist:${NC}"
    echo -e "   ✓ Environment variables are set (not in .env file)"
    echo -e "   ✓ API keys are production keys (not development)"
    echo -e "   ✓ CORS_ORIGIN is set to your frontend domain"
    echo -e "   ✓ Rate limiting is configured appropriately"
    echo -e "   ✓ SSL/TLS is configured for HTTPS"
    echo

    read -p "Have you completed the production checklist? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}💡 Please complete the production checklist first${NC}"
        echo -e "${BLUE}See ENVIRONMENT.md for detailed production setup instructions${NC}"
        exit 1
    fi

    # Set production environment
    export NODE_ENV=production
    export LOG_LEVEL=info
    export DEBUG=""

    # Run Docker setup for production
    chmod +x scripts/docker-setup.sh
    ./scripts/docker-setup.sh setup

    echo -e "${GREEN}🎉 Production deployment complete!${NC}"
    echo -e "${BLUE}💡 Monitor your application logs and set up alerts${NC}"
}

# Function to validate environment
validate_environment() {
    echo -e "${BLUE}✅ Validating Environment Configuration${NC}"
    echo

    if [ -f "scripts/validate-env.js" ]; then
        node scripts/validate-env.js
    else
        echo -e "${RED}❌ Validation script not found${NC}"
        exit 1
    fi

    echo
    read -p "Press Enter to return to main menu..."
}

# Function to show documentation
show_documentation() {
    echo -e "${BLUE}📚 Documentation and Resources${NC}"
    echo

    echo -e "${CYAN}📄 Available Documentation:${NC}"

    if [ -f "ENVIRONMENT.md" ]; then
        echo -e "${GREEN}✅ ENVIRONMENT.md${NC} - Environment variables guide"
    else
        echo -e "${YELLOW}⚠️  ENVIRONMENT.md not found${NC}"
    fi

    if [ -f "README.md" ]; then
        echo -e "${GREEN}✅ README.md${NC} - General project information"
    else
        echo -e "${YELLOW}⚠️  README.md not found${NC}"
    fi

    if [ -f ".env.template" ]; then
        echo -e "${GREEN}✅ .env.template${NC} - Environment variables template"
    else
        echo -e "${YELLOW}⚠️  .env.template not found${NC}"
    fi

    echo
    echo -e "${CYAN}🔗 Useful Links:${NC}"
    echo -e "   • Google AI Studio: https://aistudio.google.com/app/apikey"
    echo -e "   • Anthropic Console: https://console.anthropic.com/"
    echo -e "   • Cohere Dashboard: https://dashboard.cohere.ai/api-keys"
    echo -e "   • Pinecone Console: https://app.pinecone.io/"
    echo -e "   • Neon Console: https://console.neon.tech/"
    echo
    echo -e "${CYAN}🆘 Getting Help:${NC}"
    echo -e "   • Check logs: npm run docker:logs"
    echo -e "   • Validate config: npm run env:validate"
    echo -e "   • Health check: npm run health"
    echo

    read -p "Press Enter to return to main menu..."
}

# Function for advanced options
advanced_options() {
    echo -e "${BLUE}🔧 Advanced Options${NC}"
    echo

    echo -e "${CYAN}Available Commands:${NC}"
    echo -e "${YELLOW}1)${NC} npm run build          - Build TypeScript"
    echo -e "${YELLOW}2)${NC} npm run dev            - Start development server"
    echo -e "${YELLOW}3)${NC} npm run prod           - Start production server"
    echo -e "${YELLOW}4)${NC} npm run docker:setup   - Complete Docker setup"
    echo -e "${YELLOW}5)${NC} npm run docker:start   - Start Docker services"
    echo -e "${YELLOW}6)${NC} npm run docker:stop    - Stop Docker services"
    echo -e "${YELLOW}7)${NC} npm run docker:logs    - View Docker logs"
    echo -e "${YELLOW}8)${NC} npm run env:validate   - Validate environment"
    echo -e "${YELLOW}9)${NC} npm run health         - Check application health"
    echo

    echo -e "${CYAN}Manual Setup Steps:${NC}"
    echo -e "1. Copy environment template: cp .env.template .env"
    echo -e "2. Edit environment file: nano .env"
    echo -e "3. Install dependencies: npm install"
    echo -e "4. Build application: npm run build"
    echo -e "5. Start application: npm start"
    echo

    read -p "Press Enter to return to main menu..."
}

# Main menu loop
main_menu() {
    while true; do
        clear
        show_menu

        read -p "Enter your choice (0-6): " choice
        echo

        case $choice in
            1)
                check_prerequisites
                local_development_setup
                break
                ;;
            2)
                check_prerequisites
                docker_development_setup
                break
                ;;
            3)
                check_prerequisites
                production_docker_deployment
                break
                ;;
            4)
                validate_environment
                ;;
            5)
                show_documentation
                ;;
            6)
                advanced_options
                ;;
            0)
                echo -e "${BLUE}👋 Thanks for using Code Graph RAG!${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}❌ Invalid option. Please choose 0-6.${NC}"
                sleep 2
                ;;
        esac
    done
}

# Check if running with arguments
if [ $# -gt 0 ]; then
    case "$1" in
        "dev"|"development")
            check_prerequisites
            local_development_setup
            ;;
        "docker"|"docker-dev")
            check_prerequisites
            docker_development_setup
            ;;
        "prod"|"production")
            check_prerequisites
            production_docker_deployment
            ;;
        "validate"|"check")
            validate_environment
            ;;
        "help"|"--help"|"-h")
            echo -e "${BLUE}Code Graph RAG Quick Start${NC}"
            echo
            echo -e "${YELLOW}Usage:${NC}"
            echo -e "  $0                    - Interactive menu"
            echo -e "  $0 dev                - Local development setup"
            echo -e "  $0 docker             - Docker development setup"
            echo -e "  $0 prod               - Production deployment"
            echo -e "  $0 validate           - Validate environment"
            echo -e "  $0 help               - Show this help"
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            echo -e "${YELLOW}💡 Run '$0 help' for usage information${NC}"
            exit 1
            ;;
    esac
else
    # Interactive mode
    main_menu
fi
