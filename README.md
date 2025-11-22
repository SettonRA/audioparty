# 🎵 AudioParty

**Stream music together in real-time** - A WebRTC-based audio streaming party app that lets you share music from Spotify, YouTube, SoundCloud, and other web-based audio sources.

## 🌟 Features

- **Tab Audio Sharing**: Share audio from any browser tab (Spotify, YouTube, etc.)
- **Real-time Streaming**: Low-latency audio streaming using WebRTC (~200-500ms)
- **Simple Room System**: Create or join parties with 6-character room codes
- **Volume Control**: Individual volume control for listeners
- **No Data Storage**: Completely private, no recordings or data stored
- **Modern Browser Support**: Works on latest Chrome and Edge

## 🏗️ Architecture

```
┌─────────────────┐
│   Host Browser  │
│  (Spotify Tab)  │
└────────┬────────┘
         │ getDisplayMedia()
         │ captures tab audio
         ▼
┌─────────────────┐
│ WebRTC Peer     │
│ Connection      │
└────────┬────────┘
         │
         │ Socket.io (signaling)
         ▼
┌─────────────────┐
│  Node.js Server │
│  (Room Manager) │
└────────┬────────┘
         │
         │ WebRTC (audio)
         ▼
┌─────────────────┐
│ Listener 1-4    │
│  (Browsers)     │
└─────────────────┘
```

### Technology Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **WebRTC**: Native browser APIs
- **Signaling**: Socket.io for peer coordination

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

3. **Start the server**:
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
5. Keep the tab active while streaming

### As a Listener:

1. Click **"Join a Party"**
2. Enter the 6-character room code
3. Wait for connection (usually 1-3 seconds)
4. Adjust volume as needed
5. Enjoy the music!

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
- Network restrictions (corporate networks)
- Browser privacy settings

**Solutions**:
- Try on a different network
- Disable browser extensions temporarily
- Use a VPN if behind restrictive firewall

### Audio Not Playing on Listener Side

**Check**:
1. Browser autoplay policy - click anywhere on page to enable
2. System volume and browser tab not muted
3. Host tab is still active (browsers throttle inactive tabs)

### Room Code Invalid

**Solution**: Room codes are case-insensitive and expire when host disconnects. Ask host to create a new party.

## 🌐 Browser Compatibility

| Browser | Min Version | Tab Audio Sharing |
|---------|-------------|-------------------|
| Chrome  | 74+         | ✅ Full support    |
| Firefox | Not tested  | ⚠️ Limited        |
| Edge    | 79+         | ✅ Full support    |
| Safari  | Not tested  | ⚠️ Limited        |

**Note**: Safari has limited `getDisplayMedia()` support and may not work properly.

## 📁 Project Structure

```
AudioParty/
├── server/
│   ├── index.js          # Express server & Socket.io
│   └── rooms.js          # Room management logic
├── client/
│   ├── index.html        # Main UI
│   ├── css/
│   │   └── styles.css    # Styling
│   └── js/
│       ├── app.js        # Main application logic
│       ├── host.js       # Host audio capture
│       ├── listener.js   # Listener playback
│       └── webrtc.js     # WebRTC utilities
├── package.json
└── README.md
```

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

## 🤝 Contributing

Contributions welcome! Areas for improvement:

- [ ] Add TURN server support for restricted networks
- [ ] Implement chat feature
- [ ] Add music playback controls (play/pause sync)
- [ ] Support for file uploads
- [ ] Mobile app versions
- [ ] Better error handling and reconnection logic

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 💡 Tips

- **Host**: Keep your music tab active and visible for best performance
- **Host**: Close unnecessary tabs to reduce browser CPU usage
- **Listeners**: Use headphones to avoid echo if host is in same room
- **Network**: Works best on stable WiFi or wired connections
- **Privacy**: Use unique room codes and don't share publicly

## 🆘 Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review browser console for error messages
3. Ensure you're using a supported browser version
4. Test on localhost first before deploying

---

**Built with ❤️ using WebRTC, Node.js, and Socket.io**

Enjoy your AudioParty! 🎉
