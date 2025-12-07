# Song Detection Feature - Deployment Guide

## Overview
This feature adds automatic song recognition to AudioParty using ACRCloud's audio fingerprinting API. The host's audio stream is periodically sampled (every 30 seconds) and identified, with song information displayed to all participants in real-time.

## Prerequisites

1. **ACRCloud Account**: Set up with credentials in `.env`
2. **Node.js Dependencies**: Need to install new packages
3. **Server Environment**: Docker or Node.js runtime

## Deployment Steps

### 1. Navigate to the AudioParty directory
```bash
cd /path/to/audioparty
```

### 2. Pull the latest changes from the feature branch
```bash
git fetch origin
git checkout feature/song-detection
git pull origin feature/song-detection
```

### 3. Install new dependencies
```bash
npm install
```
This will install:
- `dotenv` (^16.3.1) - Environment variable management
- `acrcloud` (^1.4.0) - ACRCloud audio recognition SDK

### 4. Set up environment variables
Copy the `.env` file to the server (already created locally):
```bash
# The .env file should contain:
ACRCLOUD_HOST=identify-us-west-2.acrcloud.com
ACRCLOUD_ACCESS_KEY=Your_access_key
ACRCLOUD_ACCESS_SECRET=Your_access_secret
PORT=3000
```

### 5. Restart the application
If using Docker:
```bash
docker-compose down
docker-compose up -d --build
```

If using PM2:
```bash
pm2 restart audioparty
```

Or if running directly:
```bash
npm start
```

## Files Changed/Added

### New Files:
- `server/acrcloud-service.js` - ACRCloud service wrapper
- `client/js/song-detection.js` - Client-side audio sampling and song detection
- `.env` - Environment variables (credentials)
- `.env.example` - Template for environment variables

### Modified Files:
- `package.json` - Added dotenv and acrcloud dependencies
- `server/index.js` - Added API endpoint and socket events for song detection
- `client/index.html` - Added song display UI elements and script reference
- `client/js/host.js` - Integrated song detection initialization
- `client/js/listener.js` - Added song update reception and display
- `client/css/styles.css` - Added styling for song display components

## Features Added

### For Hosts:
- **Automatic Detection**: Songs are detected every 30 seconds automatically
- **Manual Detection**: "🔍 Detect Song Now" button for immediate detection
- **Real-time Display**: Current song shown with title, artist, and album
- **Status Indicators**: Shows detecting/detected/not found states

### For Listeners:
- **Live Updates**: See the same song information as the host
- **Real-time Sync**: Updates appear for all listeners simultaneously

### API Endpoint:
- `POST /api/identify-song` - Accepts base64-encoded audio data, returns song metadata

## How It Works

1. **Host starts streaming** → Song detection initializes
2. **Audio sampling** → Every 30 seconds, captures 10-second audio sample
3. **Processing** → Converts to WAV format, encodes to base64
4. **API call** → Sends to server's `/api/identify-song` endpoint
5. **ACRCloud** → Server forwards to ACRCloud for fingerprinting
6. **Broadcasting** → Results sent to all participants via Socket.io
7. **Display** → UI updates with song title, artist, album

## Troubleshooting

### If song detection doesn't work:

1. **Check credentials**: Verify `.env` file exists and contains correct ACRCloud keys
2. **Check logs**: Look for "Song detection initialized" in console
3. **Network issues**: Ensure server can reach ACRCloud API (identify-us-west-2.acrcloud.com)
4. **Audio quality**: Recognition works best with clear audio (no heavy distortion)
5. **API limits**: Free tier allows 2,000 queries/month (~333 hours of parties)

### Check if service is configured:
The server will log on startup. Look for any ACRCloud-related errors.

### Manual testing:
1. Start a party as host
2. Share a tab playing music (e.g., Spotify)
3. Wait 5 seconds for first detection
4. Check browser console for "Song detected: ..." messages
5. Or click "🔍 Detect Song Now" button

## Performance Impact

- **Server**: Minimal - only processes API requests (quick passthrough)
- **Client**: Low - Audio sampling runs in background, ~200-400KB data transfer per detection
- **Network**: ~500KB-1MB per detection (base64-encoded WAV audio)

## Monitoring

Check ACRCloud dashboard for:
- Query usage (free tier: 2,000/month)
- Recognition success rate
- API response times

## Rollback

If issues occur, rollback to main branch:
```bash
git checkout main
git pull origin main
npm install
# Restart application
```

The app will continue to work without song detection (feature gracefully degrades).
