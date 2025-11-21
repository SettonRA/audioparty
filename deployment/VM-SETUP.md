# AudioParty VM Deployment Guide

## VM Specifications

### Recommended Specs for Hyper-V Gen 2 VM:
- **OS:** Ubuntu Server 24.04 LTS
- **RAM:** 2 GB (minimum 1 GB)
- **CPU:** 2 vCPUs
- **Disk:** 20 GB (thin provisioned)
- **Network:** Connected to your 192.168.1.x network
- **Suggested IP:** 192.168.1.111 (or next available)
- **Hostname:** docker01 (Generic Docker host for multiple containers)

### Why These Specs?
- **Lightweight:** AudioParty uses minimal resources (max 5 concurrent users)
- **Room to grow:** Allows for OS updates and Docker images
- **Similar to Proxy01:** Consistent with your existing setup

---

## Part 1: Create Hyper-V VM

### On HV01 (Windows Hyper-V Host):

1. **Open Hyper-V Manager**

2. **Create New Virtual Machine**:
   - Name: `Docker01`
   - Generation: **Generation 2**
   - Startup Memory: `2048 MB`
   - ☑ Use Dynamic Memory
   - Network: Select your `192.168.1.x` virtual switch
   - Create Virtual Hard Disk: `20 GB` (VHDX)
   - Install from: Ubuntu Server 24.04 ISO

3. **Configure VM Settings** (before starting):
   - Processor: `2` virtual processors
   - Security: **Disable Secure Boot** (Linux support)
   - Automatic Start Action: **Automatically start**
   - Automatic Stop Action: **Save**

---

## Part 2: Install Ubuntu Server 24.04

### Ubuntu Installation:

1. **Start VM and connect** to console

2. **Installation Options**:
   - Language: English
   - Keyboard: Your layout
   - Network: 
     - **Static IP Configuration:**
       - IP: `192.168.1.111/24` (or your choice)
       - Gateway: `192.168.1.1`
       - DNS: `192.168.1.8, 8.8.8.8` (PiHole primary)
   - Storage: Use entire disk (default)
   - Profile Setup:
     - Your name: `Server Admin`
     - Server name: `docker01`
     - Username: `cray`
     - Password: `T3ch@DMCC!` (match your environment)
   - SSH: **☑ Install OpenSSH server**
   - Featured Snaps: **Skip** (we'll install Docker manually)

3. **Wait for installation** to complete and reboot

4. **First Login**:
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Reboot if kernel updated
   sudo reboot
   ```

---

## Part 3: Install Docker & Docker Compose

### SSH into your new VM from HV01 or another machine:

```bash
ssh cray@192.168.1.111
```

### Run these commands:

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (run without sudo)
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version

# Log out and back in for group membership to take effect
exit
```

**SSH back in:**
```bash
ssh cray@192.168.1.111
```

---

## Part 4: Deploy AudioParty

### Option A: Manual Deployment (Copy files from Windows)

1. **On your Windows machine** (in PowerShell):
   ```powershell
   # Navigate to AudioParty project
   cd "C:\Users\Clark\Documents\VS Code\Projects\AudioParty"
   
   # Copy files to VM using SCP
   scp -r * cray@192.168.1.111:~/audioparty/
   ```

2. **On the Ubuntu VM**:
   ```bash
   cd ~/audioparty
   
   # Make deployment script executable
   chmod +x deployment/deploy.sh
   
   # Deploy
   ./deployment/deploy.sh deploy
   ```

### Option B: Using Git (if you push to GitHub)

```bash
# On Ubuntu VM
cd ~
git clone https://github.com/yourusername/audioparty.git
cd audioparty
chmod +x deployment/deploy.sh
./deployment/deploy.sh deploy
```

### Deployment will:
- Build Docker image
- Start container
- Expose service on port 3000

### Verify it's running:
```bash
# Check container status
docker compose ps

# Check logs
docker compose logs

# Test locally
curl http://localhost:3000
```

---

## Part 5: Configure Firewall (Ubuntu)

```bash
# Allow SSH (if using UFW)
sudo ufw allow 22/tcp

# Allow AudioParty port (if accessing directly)
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable
```

**Note:** If using Nginx Proxy Manager (recommended), you only need to allow SSH.

---

## Part 6: Add to Nginx Proxy Manager (Proxy01)

### On Proxy01 (https://proxy.tech-ra.net):

1. **Login to NPM** at https://proxy.tech-ra.net

2. **Add Proxy Host**:
   - Click **"Hosts"** → **"Proxy Hosts"** → **"Add Proxy Host"**

3. **Details Tab**:
   - Domain Names: `party.cineclark.studio` (or `audioparty.tech-ra.net`)
   - Scheme: `http`
   - Forward Hostname/IP: `192.168.1.111`
   - Forward Port: `3000`
   - ☑ Cache Assets
   - ☑ Block Common Exploits
   - ☑ **Websockets Support** (Required for Socket.io!)

4. **SSL Tab**:
   - SSL Certificate: Select existing wildcard cert
     - For `*.cineclark.studio` domain
     - Or `*.tech-ra.net` domain
   - ☑ Force SSL
   - ☑ HTTP/2 Support
   - ☑ HSTS Enabled

5. **Click Save**

### Test Access:
- Navigate to: `https://party.cineclark.studio`
- You should see the AudioParty landing page

---

## Part 7: Management Commands

### Using the deployment script:

```bash
cd ~/audioparty

# View logs (real-time)
./deployment/deploy.sh logs

# Check status
./deployment/deploy.sh status

# Restart service
./deployment/deploy.sh restart

# Stop service
./deployment/deploy.sh stop

# Start service
./deployment/deploy.sh start

# Update (rebuild and restart)
./deployment/deploy.sh update
```

### Manual Docker commands:

```bash
cd ~/audioparty

# View running containers
docker compose ps

# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Start
docker compose up -d

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d
```

---

## Part 8: Add to Server Inventory

### Update your `Server-Inventory.md`:

```markdown
## Application Servers

| Host Name | IP Address | OS | Hypervisor | Username | Password | Function | Notes |
|-----------|------------|----|-----------|---------|---------|---------|----|
| Docker01 | 192.168.1.111 | Ubuntu 24.04 | HV01 | cray | T3ch@DMCC! | Docker Container Host | Generic Docker server - Runs AudioParty (https://party.cineclark.studio) |
```

---

## Troubleshooting

### Container won't start:
```bash
# Check logs
docker compose logs

# Check if port 3000 is in use
sudo netstat -tulpn | grep 3000

# Rebuild from scratch
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Can't access from browser:
1. Check container is running: `docker compose ps`
2. Check firewall: `sudo ufw status`
3. Test locally on VM: `curl http://localhost:3000`
4. Check NPM proxy host settings (Websockets!)

### WebSocket connection fails:
- **Critical:** Make sure "Websockets Support" is enabled in NPM
- Check browser console for errors
- Verify Socket.io is connecting: Look for connection messages in logs

### Out of memory:
```bash
# Check memory usage
free -h

# Check Docker stats
docker stats

# If needed, increase VM RAM to 4GB
```

---

## Backup & Recovery

### Backup:
```bash
# Stop service
cd ~/audioparty
docker compose down

# Backup entire directory
sudo tar -czf ~/audioparty-backup-$(date +%Y%m%d).tar.gz ~/audioparty

# Start service
docker compose up -d
```

### Restore:
```bash
# Extract backup
tar -xzf audioparty-backup-YYYYMMDD.tar.gz -C ~/

# Rebuild and start
cd ~/audioparty
docker compose up -d
```

---

## Monitoring

### View resource usage:
```bash
# Real-time stats
docker stats audioparty

# System resources
htop  # (install with: sudo apt install htop)
```

### Check health:
```bash
# Docker health check
docker inspect audioparty | grep -A 10 Health

# Manual test
curl -I http://localhost:3000
```

---

## Next Steps

1. ✅ Create VM in Hyper-V
2. ✅ Install Ubuntu 24.04
3. ✅ Install Docker
4. ✅ Deploy AudioParty
5. ✅ Configure NPM proxy host
6. ✅ Test from browser
7. ✅ Update server inventory
8. 🎉 Start streaming music with friends!

---

## Quick Reference

### VM Details:
- **Hostname:** docker01
- **IP:** 192.168.1.111
- **SSH:** `ssh cray@192.168.1.111`
- **AudioParty Local URL:** http://192.168.1.111:3000
- **AudioParty Public URL:** https://party.cineclark.studio
- **Container:** audioparty
- **Port:** 3000

### Key Commands:
```bash
# SSH to VM
ssh cray@192.168.1.111

# Navigate to app
cd ~/audioparty

# Quick restart
docker compose restart

# View logs
docker compose logs -f

# Check status
docker compose ps
```

---

**Need help?** Check the main [README.md](../README.md) for application-specific troubleshooting.
