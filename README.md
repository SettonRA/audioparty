# 🎵 AudioParty

**Stream music together in real-time** - A WebRTC-based audio streaming party app that lets you share music from Spotify, YouTube, SoundCloud, and other web-based audio sources.

## 🌟 Features

- **Tab Audio Sharing**: Share audio from any browser tab (Spotify, YouTube, etc.)
- **Real-time Streaming**: Low-latency audio streaming using WebRTC (~200-500ms)
- **Automatic Song Detection**: Smart silence-based song recognition using ACRCloud
  - Displays song title, artist, and album art in real-time
  - Automatically detects song changes based on audio patterns
  - Shared across all party participants
- **Audio Normalization**: Dynamic compression and gain boost for consistent volume levels
  - Automatically boosts quiet audio sources
  - Prevents volume spikes with intelligent compression
  - Ensures all listeners hear clear, balanced audio
- **Discord Integration**: Optional bot integration for sharing now playing info
  - Posts real-time song updates to Discord channel
  - Displays album art, artist, and listener count
  - Includes "Join Party" button with direct room link
  - Automatically updates when songs change (no spam)
  - Shows "Party Ended" message when host disconnects
- **Simple Room System**: Create or join parties with 6-character room codes
- **Individual Volume Control**: Personal volume slider for each listener (0-100%)
- **No Data Storage**: Completely private, no recordings or data stored
- **Modern UI**: Clean interface with logo and real-time status indicators
- **Modern Browser Support**: Works on latest Chrome and Edge


### Technology Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **WebRTC**: Native browser APIs for peer-to-peer audio streaming
  - STUN servers for NAT traversal
  - Optional TURN server support for relay connections
- **Web Audio API**: Real-time audio processing, compression, and analysis
- **ACRCloud API**: Audio fingerprinting for song recognition
- **Discord.js**: Bot integration for Discord channel updates
- **Signaling**: Socket.io for peer coordination and song metadata broadcast

## 🚀 Quick Start

### Prerequisites

- Node.js 14+ and npm
- Modern browser (Chrome or Edge)

### Installation

1. **Clone or navigate to the project**:
   ```bash
   cd AudioParty
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env and add your credentials
   ```
   
   **Required for song detection:**
   - Sign up at [ACRCloud Console](https://console.acrcloud.com/)
   - Create a new project with "Audio & Video Recognition" type
   - Copy your Host, Access Key, and Access Secret to `.env`
   
   **Optional for Discord integration:**
   - See [DISCORD-SETUP.md](DISCORD-SETUP.md) for detailed instructions
   - Add your Discord bot token, channel ID, and AudioParty URL to `.env`
   
   **Optional for TURN server (VPN/external connections):**
   - Set up a TURN server for WebRTC relay when direct connections fail
   - Add `TURN_SERVER_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` to `.env`
   - See [TURN Server Setup](#turn-server-setup) section below

4. **Start the server**:
   ```bash
   npm start
   ```

4. **Open in browser**:
   Navigate to `http://localhost:3000`

### Development Mode

For auto-restart on file changes:
```bash
npm run dev
```

## 📖 How to Use

### As a Host:

1. Click **"Host a Party"**
2. Click **"Share Audio Tab"**
3. In the browser dialog:
   - Select the tab playing music (Spotify, YouTube, etc.)
   - **Important**: Check "Share audio" or "Share tab audio"
4. Share the 6-character room code with friends
5. Song detection will automatically identify tracks as they play
6. Audio is automatically normalized for optimal listening quality
7. Keep the tab active while streaming

### As a Listener:

1. Click **"Join a Party"**
2. Enter the 6-character room code
3. Wait for connection (usually 1-3 seconds)
4. See currently playing song information in real-time
5. Adjust volume as needed with the volume slider
6. Enjoy the music with optimized audio quality!

## 🔧 Configuration

### Change Server Port

Edit `server/index.js`:
```javascript
const PORT = process.env.PORT || 3000;
```

Or set environment variable:
```bash
PORT=8080 npm start
```

### HTTPS for Production

WebRTC requires HTTPS in production. Use a reverse proxy like nginx or deploy to platforms that provide SSL:
- Heroku
- Railway
- Render
- DigitalOcean App Platform

Example nginx config:
```nginx
server {
    listen 443 ssl;
    server_name audioparty.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

## 🐛 Troubleshooting

### "No audio track found" Error

**Solution**: When sharing, make sure to check the "Share audio" checkbox in the browser dialog.

### "Connection failed" Error

**Causes**:
- Firewall blocking WebRTC
- Network restrictions (corporate networks, VPNs)
- NAT traversal issues
- Browser privacy settings

**Solutions**:
- Try on a different network
- Disable browser extensions temporarily
- Set up a TURN server (see TURN Server Setup below)
- Check if both users can reach the same network

### Audio Not Playing on Listener Side

**Check**:
1. Browser autoplay policy - click anywhere on page to enable
2. System volume and browser tab not muted
3. Host tab is still active (browsers throttle inactive tabs)

### Room Code Invalid

**Solution**: Room codes are case-insensitive and expire when host disconnects. Ask host to create a new party.

## 🌐 Browser Compatibility

| Browser | Tab Audio Sharing |
|---------|-------------------|
| Chrome  | ✅ Full support   |
| Edge    | ✅ Full support   |
| Firefox | ⚠️ Listen only    |
| Safari  | ⚠️ Not Tested     |

**Note**: Safari has limited `getDisplayMedia()` support and may not work properly.


## 🔐 Privacy & Security

- **No recording**: Audio is streamed directly between peers, never stored
- **Temporary rooms**: Rooms are deleted when host disconnects
- **No authentication**: Simple room codes for privacy
- **Direct P2P**: Audio streams directly between browsers (server only coordinates)

## 🚀 Deployment

### Heroku

```bash
# Create Heroku app
heroku create audioparty-app

# Deploy
git push heroku main

# Open app
heroku open
```

### Railway

1. Connect GitHub repo to Railway
2. Deploy automatically on push
3. Railway provides HTTPS by default

### DigitalOcean

1. Create a new App
2. Connect repository
3. Set build command: `npm install`
4. Set run command: `npm start`

## 🌐 TURN Server Setup

For connections across different networks, VPNs, or restrictive firewalls, you'll need a TURN server to relay WebRTC traffic.

### Quick Setup with Public TURN Servers

AudioParty includes fallback public TURN servers by default. However, these may be unreliable. For production use, set up your own TURN server.

### Self-Hosted TURN Server (Recommended)

**Requirements:**
- A server with a public IP address
- Ports 3478 (UDP/TCP) and 5349 (UDP/TCP) forwarded

**Using Coturn (Docker):**

1. **Set up coturn** (see separate coturn project):
   ```bash
   # Deploy coturn container with your configuration
   docker run -d --network=host \
     -v ./turnserver.conf:/etc/coturn/turnserver.conf \
     coturn/coturn
   ```

2. **Configure DNS**:
   - Create an A record: `turn.yourdomain.com` → Your public IP

3. **Add to AudioParty `.env`**:
   ```env
   TURN_SERVER_URL=turn:turn.yourdomain.com:3478
   TURN_USERNAME=your_username
   TURN_CREDENTIAL=your_password
   ```

4. **Restart AudioParty**:
   ```bash
   npm start
   ```

**Testing TURN Server:**
- Use [WebRTC Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) to test your TURN server
- You should see "relay" type candidates if TURN is working

### Benefits of TURN Server

- ✅ Connections work across VPNs
- ✅ Works behind restrictive firewalls
- ✅ Reliable connections for external users
- ✅ Better connection success rate (90%+ vs 60-70% with STUN only)

## 🎵 Song Recognition

AudioParty includes automatic song detection powered by ACRCloud:

- **Automatic**: Detects songs every 30 seconds
- **Manual**: Click "Detect Song Now" for immediate recognition
- **Real-time**: Song info displayed to all participants
- **Setup**: Get free API credentials at [console.acrcloud.com](https://console.acrcloud.com)
- **Free tier**: 2,000 recognitions/month (~333 hours of parties)

See `SONG-DETECTION-DEPLOYMENT.md` for detailed setup instructions.

## 💡 Tips

- **Host**: Keep your music tab active and visible for best performance
- **Host**: Close unnecessary tabs to reduce browser CPU usage
- **Listeners**: Use headphones to avoid echo if host is in same room
- **Network**: Works best on stable WiFi or wired connections
- **Privacy**: Use unique room codes and don't share publicly
- **Song Detection**: Works best with clear audio (avoid heavily compressed streams)



---

**Built using WebRTC, Node.js, and Socket.io**

Enjoy your AudioParty! 🎉
