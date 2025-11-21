# AudioParty

WebRTC-based audio streaming party app for sharing music with friends in real-time.

## 🎵 Features

- Stream audio from Spotify, YouTube, SoundCloud, and other web services
- Low-latency WebRTC peer-to-peer streaming
- Support for up to 5 simultaneous participants (1 host + 4 listeners)
- Simple room-based party system with 6-character codes
- Individual volume control for listeners
- Docker containerized deployment

## 🚀 Quick Deploy

### Prerequisites
- Ubuntu 24.04 LTS server
- Docker & Docker Compose installed
- 2GB RAM, 2 vCPU minimum

### Deployment

```bash
# Clone repository
git clone https://github.com/SettonRA/audioparty.git
cd audioparty

# Deploy using script
chmod +x deployment/deploy.sh
./deployment/deploy.sh deploy

# Access at http://your-server-ip:3000
```

## 📖 Documentation

- [Complete VM Setup Guide](deployment/VM-SETUP.md)
- [Nginx Proxy Manager Config](deployment/NPM-CONFIG.md)
- [Deployment Guide](deployment/README.md)

## 🛠️ Management

```bash
# View logs
./deployment/deploy.sh logs

# Restart service
./deployment/deploy.sh restart

# Update
./deployment/deploy.sh update
```

## 🌐 Architecture

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Real-time:** WebRTC for audio streaming
- **Deployment:** Docker container

## 📝 License

MIT License - Feel free to use and modify
