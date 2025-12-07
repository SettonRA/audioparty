#!/bin/bash
#
# AudioParty Deployment Script
# This script handles the deployment and management of AudioParty on Ubuntu 24.04
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="$HOME/audioparty"
REPO_URL="https://github.com/SettonRA/audioparty.git"  # Update this if using your own git
SERVICE_PORT=3000

# Functions
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please run the setup script first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running or you don't have permission."
        print_status "Try: sudo usermod -aG docker $USER (then log out and back in)"
        exit 1
    fi
    
    print_status "Docker is installed and running"
}

check_port() {
    if netstat -tuln 2>/dev/null | grep -q ":${SERVICE_PORT} "; then
        print_warning "Port ${SERVICE_PORT} is already in use"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

deploy_app() {
    print_status "Deploying AudioParty..."
    
    # Create app directory if it doesn't exist
    if [ ! -d "$APP_DIR" ]; then
        print_status "Creating application directory at $APP_DIR"
        mkdir -p "$APP_DIR"
    fi
    
    cd "$APP_DIR"
    
    # Copy files (assuming they're in current directory)
    if [ -f "docker-compose.yml" ]; then
        print_status "docker-compose.yml already exists"
    else
        print_error "docker-compose.yml not found. Please copy AudioParty files to this directory first."
        exit 1
    fi
    
    # Build and start containers
    print_status "Building Docker image..."
    docker compose build
    
    print_status "Starting AudioParty..."
    docker compose up -d
    
    # Wait for service to be ready
    print_status "Waiting for service to start..."
    sleep 5
    
    # Check if container is running
    if docker compose ps | grep -q "running"; then
        print_status "✓ AudioParty is now running!"
        print_status "Access it at: http://$(hostname -I | awk '{print $1}'):${SERVICE_PORT}"
    else
        print_error "Failed to start AudioParty. Check logs with: docker compose logs"
        exit 1
    fi
}

update_app() {
    print_status "Updating AudioParty..."
    
    cd "$APP_DIR"
    
    # Pull latest changes if using git
    # git pull
    
    # Rebuild and restart
    print_status "Rebuilding image..."
    docker compose build --no-cache
    
    print_status "Restarting service..."
    docker compose down
    docker compose up -d
    
    print_status "✓ AudioParty updated successfully!"
}

stop_app() {
    print_status "Stopping AudioParty..."
    cd "$APP_DIR"
    docker compose down
    print_status "✓ AudioParty stopped"
}

start_app() {
    print_status "Starting AudioParty..."
    cd "$APP_DIR"
    docker compose up -d
    print_status "✓ AudioParty started"
}

restart_app() {
    print_status "Restarting AudioParty..."
    cd "$APP_DIR"
    docker compose restart
    print_status "✓ AudioParty restarted"
}

show_logs() {
    cd "$APP_DIR"
    docker compose logs -f
}

show_status() {
    cd "$APP_DIR"
    echo -e "\n${GREEN}Container Status:${NC}"
    docker compose ps
    echo -e "\n${GREEN}Resource Usage:${NC}"
    docker stats --no-stream audioparty
}

cleanup() {
    print_warning "This will remove all AudioParty containers and images"
    read -p "Are you sure? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$APP_DIR"
        docker compose down -v
        docker rmi audioparty:latest 2>/dev/null || true
        print_status "✓ Cleanup complete"
    fi
}

show_help() {
    cat << EOF
AudioParty Deployment Script

Usage: $0 [COMMAND]

Commands:
    deploy      Deploy AudioParty (first time setup)
    update      Update AudioParty to latest version
    start       Start AudioParty service
    stop        Stop AudioParty service
    restart     Restart AudioParty service
    logs        View real-time logs
    status      Show service status and resource usage
    cleanup     Remove all containers and images
    help        Show this help message

Examples:
    $0 deploy       # Initial deployment
    $0 logs         # View logs
    $0 restart      # Restart service

EOF
}

# Main script logic
case "${1:-help}" in
    deploy)
        check_docker
        check_port
        deploy_app
        ;;
    update)
        check_docker
        update_app
        ;;
    start)
        check_docker
        start_app
        ;;
    stop)
        check_docker
        stop_app
        ;;
    restart)
        check_docker
        restart_app
        ;;
    logs)
        show_logs
        ;;
    status)
        show_status
        ;;
    cleanup)
        cleanup
        ;;
    help|*)
        show_help
        ;;
esac
