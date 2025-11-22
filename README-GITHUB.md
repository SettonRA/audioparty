# AudioParty 🎵

Stream music together in real-time. Share your browser tab's audio (Spotify, YouTube, SoundCloud, etc.) with up to 10 friends using WebRTC technology.

## Features

- **High-Quality Audio Streaming** - 48kHz stereo, 510kbps bitrate for near CD-quality
- **Room-Based Parties** - Simple 6-character room codes for easy joining
- **Low Latency** - Peer-to-peer WebRTC streaming for minimal delay
- **Individual Volume Control** - Each listener controls their own volume
- **Shareable Join Links** - Copy and share direct join URLs
- **Privacy Focused** - No data stored, rooms expire when host leaves
- **Up to 10 Participants** - 1 host + 9 listeners per party

## Browser Compatibility

| Browser | Host | Listen |
|---------|------|--------|
| Chrome | ✅ | ✅ |
| Edge | ✅ | ✅ |
| Brave | ✅ | ✅ |
| Opera | ✅ | ✅ |
| Firefox | ❌ | ❌ |

**Note:** Hosting requires a Chromium-based browser due to tab audio capture requirements. Firefox does not support the necessary `getDisplayMedia` audio features.

## Quick Start

### Docker Deployment

```bash
# Clone the repository
git clone https://github.com/SettonRA/audioparty.git
cd audioparty

# Build and run
docker compose up -d

# Access at http://localhost:3000
```

### Manual Setup

```bash
# Install dependencies
npm install

# Start the server
npm start

# Access at http://localhost:3000
```

## How It Works

1. **Host** clicks "Host a Party" and shares their browser tab playing music
2. **Listeners** join using the room code or direct link
3. **Audio** streams peer-to-peer via WebRTC with minimal latency
4. **Everyone** enjoys synchronized music together!

## Technology Stack

- **Backend:** Node.js 20, Express 4.18, Socket.io 4.6
- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Streaming:** WebRTC (STUN-based NAT traversal)
- **Audio Quality:** Opus codec, 48kHz, stereo, 510kbps
- **Deployment:** Docker with multi-stage Alpine builds

## Troubleshooting

### Connection Issues
- **VPN/Firewall:** Disable VPN or configure firewall to allow WebRTC
- **Corporate Networks:** May block peer-to-peer connections
- **Network Type:** Works best across different networks (mobile hotspot + WiFi)

### Audio Not Playing
- Ensure "Share audio" is checked when selecting the tab
- Check browser permissions for audio/microphone
- Verify system volume and AudioParty volume slider

### Browser Compatibility
- Use Chrome, Edge, Brave, or Opera for hosting
- Firefox cannot host due to browser limitations

## Configuration

Default port: `3000`

To change the port, set the `PORT` environment variable:
```bash
PORT=8080 npm start
```

Or in Docker:
```yaml
environment:
  - PORT=8080
ports:
  - "8080:8080"
```

## License

MIT License - Free to use and modify

## Contributing

Contributions welcome! Please open an issue or pull request.
