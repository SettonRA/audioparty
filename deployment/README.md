# AudioParty - Deployment Quick Start

Complete deployment package for running AudioParty on a dedicated Ubuntu 24.04 VM with Docker and Nginx Proxy Manager integration.

---

## 📦 What's Included

```
deployment/
├── VM-SETUP.md      # Complete VM creation and deployment guide
├── NPM-CONFIG.md    # Nginx Proxy Manager configuration
└── deploy.sh        # Automated deployment script
```

---

## 🚀 Quick Start

### Step 1: Create Ubuntu VM
Follow **[VM-SETUP.md](VM-SETUP.md)** for:
- Hyper-V VM creation (2GB RAM, 2 vCPU, 20GB disk)
- Ubuntu 24.04 installation with static IP
- Docker installation
- AudioParty deployment

**Recommended IP:** `192.168.1.111`

### Step 2: Deploy AudioParty

**Copy files to VM:**
```powershell
# From Windows (PowerShell)
cd "C:\Users\Clark\Documents\VS Code\Projects\AudioParty"
scp -r * serveradmin@192.168.1.111:~/audioparty/
```

**Deploy on VM:**
```bash
# SSH to VM
ssh serveradmin@192.168.1.111

# Navigate and deploy
cd ~/audioparty
chmod +x deployment/deploy.sh
./deployment/deploy.sh deploy
```

### Step 3: Configure Nginx Proxy Manager
Follow **[NPM-CONFIG.md](NPM-CONFIG.md)** to:
- Add proxy host: `party.cineclark.studio`
- Configure SSL with existing wildcard cert
- Enable WebSocket support (critical!)

---

## 🎯 Target Environment

Based on your existing infrastructure:

| Component | Details |
|-----------|---------|
| **Hypervisor** | HV01 (Windows Hyper-V) |
| **Reverse Proxy** | Proxy01 (192.168.1.110) - Nginx Proxy Manager |
| **New VM** | AudioParty (192.168.1.111) |
| **SSL Cert** | Existing `*.cineclark.studio` wildcard |
| **Public URL** | https://party.cineclark.studio |
| **Network** | 192.168.1.0/24 |

---

## 📋 Deployment Checklist

- [ ] Create Hyper-V Gen 2 VM
- [ ] Install Ubuntu 24.04 LTS
- [ ] Configure static IP: 192.168.1.111
- [ ] Install Docker & Docker Compose
- [ ] Copy AudioParty files to VM
- [ ] Run deployment script
- [ ] Verify container is running
- [ ] Add proxy host in NPM
- [ ] Enable WebSocket support
- [ ] Test HTTPS access
- [ ] Update server inventory

---

## 🛠️ Management

### Deployment Script Commands:

```bash
# View logs
./deployment/deploy.sh logs

# Check status
./deployment/deploy.sh status

# Restart
./deployment/deploy.sh restart

# Update
./deployment/deploy.sh update

# Stop
./deployment/deploy.sh stop
```

### Manual Docker Commands:

```bash
cd ~/audioparty

# View logs
docker compose logs -f

# Restart
docker compose restart

# Rebuild
docker compose build --no-cache
docker compose up -d
```

---

## 🌐 Access

### Internal Network:
- **Direct:** http://192.168.1.111:3000
- **Via Proxy:** https://party.cineclark.studio

### External (If DNS configured):
- **Public:** https://party.cineclark.studio

### Admin:
- **SSH:** `ssh serveradmin@192.168.1.111`
- **NPM:** https://proxy.tech-ra.net

---

## 📖 Full Documentation

- **[VM-SETUP.md](VM-SETUP.md)** - Complete VM setup guide
- **[NPM-CONFIG.md](NPM-CONFIG.md)** - Proxy configuration
- **[../README.md](../README.md)** - Application documentation

---

## ⚡ Quick Commands Reference

```bash
# SSH to VM
ssh serveradmin@192.168.1.111

# Navigate to app
cd ~/audioparty

# View status
docker compose ps

# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Start
docker compose up -d
```

---

## 🔧 Troubleshooting

### Container won't start:
```bash
docker compose logs
docker compose build --no-cache
docker compose up -d
```

### Can't access from browser:
1. Check container: `docker compose ps`
2. Check locally: `curl http://localhost:3000`
3. Check NPM WebSocket setting
4. Check SSL certificate

### WebSocket connection fails:
- **Most common issue:** WebSocket support not enabled in NPM
- Go to NPM → Edit proxy host → Enable "Websockets Support"

---

## 📊 Server Inventory Entry

Add to your `Server-Inventory.md`:

```markdown
| AudioParty | 192.168.1.111 | Ubuntu 24.04 | HV01 | serveradmin | T3ch@DMCC! | Music Streaming Party | https://party.cineclark.studio |
```

---

## 🎉 You're Ready!

Your AudioParty will be accessible at:
# 🎵 **https://party.cineclark.studio**

Start hosting listening parties with friends!
