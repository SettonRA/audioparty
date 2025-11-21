#!/bin/bash

###############################################################################
# AudioParty Automated Update Script
# Updates Ubuntu packages and Docker containers
# Reboots only if required (kernel/critical updates)
###############################################################################

# Configuration
LOG_FILE="/home/cray/logs/updates.log"
COMPOSE_DIR="/home/cray/audioparty"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create log directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1" | tee -a "$LOG_FILE"
}

# Start update process
log "========================================"
log "Starting AudioParty automated update"
log "========================================"

# Check if reboot is required before updates
REBOOT_REQUIRED_BEFORE=false
if [ -f /var/run/reboot-required ]; then
    REBOOT_REQUIRED_BEFORE=true
    warn "System already requires reboot before updates"
fi

# Variables to track updates
SYSTEM_UPDATES=0
DOCKER_UPDATES=false
UPDATE_ERRORS=false

###############################################################################
# Part 1: Update Ubuntu System
###############################################################################
log "Updating Ubuntu system packages..."

# Update package lists
info "Updating package lists..."
if sudo apt-get update >> "$LOG_FILE" 2>&1; then
    log "Package lists updated successfully"
else
    error "Failed to update package lists"
    UPDATE_ERRORS=true
fi

# Check how many packages can be upgraded
UPGRADABLE=$(apt list --upgradable 2>/dev/null | grep -c upgradable)
if [ "$UPGRADABLE" -gt 1 ]; then
    SYSTEM_UPDATES=$((UPGRADABLE - 1))
    info "Found $SYSTEM_UPDATES packages to upgrade"
fi

# Upgrade packages
info "Upgrading packages..."
if sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y >> "$LOG_FILE" 2>&1; then
    log "Packages upgraded successfully"
else
    error "Package upgrade failed"
    UPDATE_ERRORS=true
fi

# Dist-upgrade (for kernel and major updates)
info "Performing dist-upgrade..."
if sudo DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y >> "$LOG_FILE" 2>&1; then
    log "Dist-upgrade completed successfully"
else
    error "Dist-upgrade failed"
    UPDATE_ERRORS=true
fi

# Autoremove unnecessary packages
info "Removing unnecessary packages..."
if sudo apt-get autoremove -y >> "$LOG_FILE" 2>&1; then
    log "Autoremove completed successfully"
else
    warn "Autoremove had issues (non-critical)"
fi

# Clean up package cache
info "Cleaning package cache..."
if sudo apt-get autoclean -y >> "$LOG_FILE" 2>&1; then
    log "Autoclean completed successfully"
else
    warn "Autoclean had issues (non-critical)"
fi

###############################################################################
# Part 2: Update Docker Containers
###############################################################################
log "Updating Docker containers..."

if [ -d "$COMPOSE_DIR" ]; then
    cd "$COMPOSE_DIR" || {
        error "Failed to change to Docker Compose directory"
        UPDATE_ERRORS=true
    }
    
    # Pull latest images
    info "Pulling latest Docker images..."
    if docker compose pull >> "$LOG_FILE" 2>&1; then
        log "Docker images pulled successfully"
        DOCKER_UPDATES=true
    else
        error "Failed to pull Docker images"
        UPDATE_ERRORS=true
    fi
    
    # Recreate containers with new images
    if [ "$DOCKER_UPDATES" = true ]; then
        info "Recreating containers..."
        if docker compose up -d >> "$LOG_FILE" 2>&1; then
            log "Containers recreated successfully"
        else
            error "Failed to recreate containers"
            UPDATE_ERRORS=true
        fi
    fi
    
    # Clean up old images
    info "Cleaning up old Docker images..."
    if docker image prune -f >> "$LOG_FILE" 2>&1; then
        log "Docker cleanup completed"
    else
        warn "Docker cleanup had issues (non-critical)"
    fi
else
    warn "Docker Compose directory not found: $COMPOSE_DIR"
fi

###############################################################################
# Part 3: Check for Reboot Requirement
###############################################################################
REBOOT_REQUIRED_AFTER=false
if [ -f /var/run/reboot-required ]; then
    REBOOT_REQUIRED_AFTER=true
    warn "System requires reboot after updates"
    
    # Read reasons for reboot
    if [ -f /var/run/reboot-required.pkgs ]; then
        info "Packages requiring reboot:"
        cat /var/run/reboot-required.pkgs | tee -a "$LOG_FILE"
    fi
fi

###############################################################################
# Part 4: Summary and Reboot
###############################################################################
log "========================================"
log "Update Summary:"
log "• System packages updated: $SYSTEM_UPDATES"
log "• Docker containers updated: $DOCKER_UPDATES"
log "• Errors encountered: $UPDATE_ERRORS"
log "• Reboot required: $REBOOT_REQUIRED_AFTER"
log "========================================"

# Perform reboot if required
if [ "$REBOOT_REQUIRED_AFTER" = true ]; then
    log "Scheduling reboot in 1 minute..."
    sudo shutdown -r +1 "System reboot required after updates" >> "$LOG_FILE" 2>&1
    log "System will reboot in 1 minute"
else
    log "No reboot required. Update completed successfully."
fi

# Exit with appropriate code
if [ "$UPDATE_ERRORS" = true ]; then
    error "Update completed with errors. Check log: $LOG_FILE"
    exit 1
else
    log "All updates completed successfully!"
    exit 0
fi
