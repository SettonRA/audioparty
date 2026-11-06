require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const RoomManager = require('./rooms');
const ACRCloudService = require('./acrcloud-service');
const discordService = require('./discord-service');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Tolerate brief network stalls / backgrounded tabs before declaring a socket dead
  pingInterval: 25000,
  pingTimeout: 60000
});

// How long a room survives after its host's socket drops, waiting for the host to reconnect
const HOST_GRACE_MS = (parseInt(process.env.HOST_GRACE_SECONDS, 10) || 60) * 1000;

const PORT = process.env.PORT || 3000;
const roomManager = new RoomManager();
const acrCloudService = new ACRCloudService();

// Maximum time a session may stay active before being auto-terminated
const SESSION_MAX_HOURS = parseFloat(process.env.SESSION_MAX_HOURS) || 6;
const MAX_SESSION_DURATION_MS = SESSION_MAX_HOURS * 60 * 60 * 1000;
const SESSION_EXPIRY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

// Ends a room/session, notifying participants and cleaning up Discord + room state
function terminateRoom(roomId, reason) {
  const room = roomManager.getRoom(roomId);
  if (!room) return false;

  io.to(roomId).emit('host-disconnected', { reason });

  if (room.discordSharingEnabled) {
    discordService.partyEnded(room.id);
  }

  roomManager.deleteRoom(roomId);
  console.log(`Room ${roomId} ended: ${reason}`);
  return true;
}

// Periodically sweep for sessions that have exceeded the max duration
setInterval(() => {
  const now = Date.now();
  for (const room of roomManager.getAllRooms()) {
    if (now - room.createdAt >= MAX_SESSION_DURATION_MS) {
      terminateRoom(room.id, 'Session reached the 6-hour time limit and was automatically ended');
    }
  }
}, SESSION_EXPIRY_CHECK_INTERVAL_MS);

// Initialize Discord bot
discordService.initialize().catch(err => {
  console.error('Discord initialization error:', err);
});

// Middleware
app.use(express.json({ limit: '10mb' }));

// Disable caching for JavaScript files to ensure clients get latest code
app.use((req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// Basic auth middleware for admin panel
const basicAuth = (req, res, next) => {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // If credentials are not configured, allow access without auth
  if (!adminUsername || !adminPassword) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AudioParty Admin"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (username === adminUsername && password === adminPassword) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="AudioParty Admin"');
  return res.status(401).send('Invalid credentials');
};

// Admin panel route
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/admin.html'));
});

// Admin API: Get all active sessions
app.get('/api/admin/sessions', basicAuth, (req, res) => {
  const rooms = roomManager.getAllRooms();
  const sessions = rooms.map(room => ({
    roomId: room.id,
    hostId: room.hostId,
    participantCount: room.participants.length,
    currentSong: room.currentSong,
    createdAt: room.createdAt,
    discordSharing: room.discordSharingEnabled
  }));
  res.json({ sessions });
});

// Admin API: End a session
app.post('/api/admin/end-session', basicAuth, (req, res) => {
  const { roomId } = req.body;
  
  if (!roomId) {
    return res.status(400).json({ success: false, error: 'Room ID required' });
  }

  const ended = terminateRoom(roomId, 'Session ended by admin');

  if (!ended) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  res.json({ success: true, message: 'Session ended successfully' });
});

// API endpoint to get ICE server configuration
app.get('/api/ice-servers', (req, res) => {
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };
  
  // Add TURN server if configured
  if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.iceServers.push({
      urls: process.env.TURN_SERVER_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
    
    // Add public TURN fallback
    iceServers.iceServers.push({
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });
    iceServers.iceServers.push({
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });
  }
  
  res.json(iceServers);
});

// API endpoint to check TURN server status
app.get('/api/turn-status', async (req, res) => {
  if (!process.env.TURN_SERVER_URL) {
    return res.json({ available: false, message: 'TURN server not configured' });
  }
  
  // Extract host and port from TURN URL
  const turnUrl = process.env.TURN_SERVER_URL;
  const match = turnUrl.match(/turn:([^:]+):(\d+)/);
  
  if (!match) {
    return res.json({ available: false, message: 'Invalid TURN URL format' });
  }
  
  const [, host, port] = match;
  
  // Simple TCP connection test to check if TURN server is reachable
  const net = require('net');
  const socket = new net.Socket();
  const timeout = 3000; // 3 second timeout
  
  let isConnected = false;
  
  socket.setTimeout(timeout);
  
  socket.on('connect', () => {
    isConnected = true;
    socket.destroy();
    res.json({ 
      available: true, 
      message: 'TURN server is reachable',
      server: `${host}:${port}`
    });
  });
  
  socket.on('timeout', () => {
    socket.destroy();
    if (!isConnected) {
      res.json({ 
        available: false, 
        message: 'TURN server connection timeout',
        server: `${host}:${port}`
      });
    }
  });
  
  socket.on('error', (err) => {
    if (!isConnected) {
      res.json({ 
        available: false, 
        message: `TURN server unreachable: ${err.message}`,
        server: `${host}:${port}`
      });
    }
  });
  
  socket.connect(parseInt(port), host);
});

// Catch-all route to serve index.html for room codes (enables URL-based room joining)
// Only match paths that look like room codes (6 alphanumeric characters)
app.get('/:roomCode([A-Z0-9]{6})', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Song recognition endpoint
app.post('/api/identify-song', async (req, res) => {
  try {
    console.log('Song identification request received');
    
    if (!acrCloudService.isConfigured()) {
      console.log('ACRCloud not configured');
      return res.status(503).json({
        success: false,
        error: 'Song recognition not configured'
      });
    }

    const { audioData } = req.body;
    
    if (!audioData) {
      console.log('No audio data in request');
      return res.status(400).json({
        success: false,
        error: 'No audio data provided'
      });
    }

    console.log(`Received audio data, size: ${audioData.length} bytes (base64)`);

    // Convert base64 audio data to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    console.log(`Audio buffer size: ${audioBuffer.length} bytes`);
    
    // Identify the song
    console.log('Sending to ACRCloud...');
    const result = await acrCloudService.identify(audioBuffer);
    console.log('ACRCloud result:', JSON.stringify(result, null, 2));
    
    res.json(result);
  } catch (error) {
    console.error('Song identification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', (callback) => {
    const room = roomManager.createRoom(socket.id);
    socket.join(room.id);
    console.log(`Room created: ${room.id} by ${socket.id}`);
    callback({ success: true, roomId: room.id, hostToken: room.hostToken });
  });

  // Host reconnected after a socket drop: reclaim the room under the new socket id
  socket.on('resume-host', (data, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = data && roomManager.getRoom(data.roomId);

    if (!room || room.hostToken !== data.hostToken) {
      console.log(`resume-host rejected for ${socket.id} (room ${data && data.roomId} not found or bad token)`);
      respond({ success: false, error: 'Room no longer exists' });
      return;
    }

    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }

    const oldHostId = room.hostId;
    room.hostId = socket.id;
    room.participants = room.participants.map(id => (id === oldHostId ? socket.id : id));
    socket.join(room.id);

    console.log(`Host resumed room ${room.id}: ${oldHostId} -> ${socket.id}`);
    io.to(room.id).emit('host-resumed', { hostId: socket.id });
    respond({
      success: true,
      roomId: room.id,
      listeners: room.participants.filter(id => id !== socket.id),
      participantCount: room.participants.length
    });
  });

  // Join an existing room
  socket.on('join-room', (roomId) => {
    console.log(`join-room request from ${socket.id} for room ${roomId}`);
    const room = roomManager.getRoom(roomId);
    
    if (!room) {
      console.log(`Room ${roomId} not found`);
      socket.emit('join-room-response', { success: false, error: 'Room not found' });
      return;
    }

    if (room.participants.length >= 10) {
      console.log(`Room ${roomId} is full`);
      socket.emit('join-room-response', { success: false, error: 'Room is full (max 10 participants)' });
      return;
    }

    if (room.participants.includes(socket.id)) {
      console.log(`User ${socket.id} already in room ${roomId}`);
      socket.emit('join-room-response', { success: false, error: 'Already in this room' });
      return;
    }

    roomManager.addParticipant(roomId, socket.id);
    socket.join(roomId);
    
    // Notify host that a listener joined
    io.to(room.hostId).emit('listener-joined', {
      listenerId: socket.id,
      participantCount: room.participants.length
    });

    // Notify all listeners in the room about the updated count
    io.to(roomId).emit('participant-count-updated', {
      participantCount: room.participants.length
    });

    const responseData = { 
      success: true,
      roomId: roomId,
      hostId: room.hostId,
      participantCount: room.participants.length 
    };
    console.log(`User ${socket.id} joined room ${roomId}, sending response:`, JSON.stringify(responseData));
    socket.emit('join-room-response', responseData);
  });

  // WebRTC Signaling: Forward offer from host to listener
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.target}`);
    io.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  // WebRTC Signaling: Forward answer from listener to host
  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.target}`);
    io.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  // WebRTC Signaling: Forward ICE candidates
  socket.on('ice-candidate', (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.target}, candidate type: ${data.candidate?.type || 'unknown'}`);
    const forwardData = {
      candidate: data.candidate,
      sender: socket.id
    };
    console.log('Forwarding ICE candidate with sender:', forwardData.sender);
    io.to(data.target).emit('ice-candidate', forwardData);
  });

  // Enable Discord sharing
  socket.on('enable-discord-sharing', (data) => {
    const { roomId } = data;
    const room = roomManager.getRoom(roomId);
    if (room && room.hostId === socket.id) {
      room.discordSharingEnabled = true;
      console.log(`Discord sharing enabled for room ${roomId}`);
    }
  });

  // Song detection: Broadcast detected song to room
  socket.on('song-detected', (data) => {
    const { roomId, song } = data;
    console.log(`Song detected in room ${roomId}:`, song.title, '-', song.artist);
    
    // Update room's current song
    roomManager.updateCurrentSong(roomId, song);
    
    // Broadcast to all participants in the room (including host)
    io.to(roomId).emit('song-update', {
      song: song,
      timestamp: new Date().toISOString()
    });
    
    // Update Discord if enabled for this room
    const room = roomManager.getRoom(roomId);
    if (room && room.discordSharingEnabled) {
      discordService.updateNowPlaying(roomId, song, room.participants.length);
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id} (reason: ${reason})`);
    const room = roomManager.getRoomByParticipant(socket.id);

    if (room) {
      if (room.hostId === socket.id) {
        // Host's socket dropped - hold the room open briefly so the host can reconnect
        const roomId = room.id;
        io.to(roomId).emit('host-reconnecting', { graceSeconds: HOST_GRACE_MS / 1000 });
        console.log(`Host of room ${roomId} dropped (${reason}); holding room for ${HOST_GRACE_MS / 1000}s`);

        if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
        room.hostGraceTimer = setTimeout(() => {
          room.hostGraceTimer = null;
          console.log(`Room ${roomId} grace period expired - host did not return`);
          terminateRoom(roomId, 'Host disconnected');
        }, HOST_GRACE_MS);
      } else {
        // Listener left - notify host
        roomManager.removeParticipant(room.id, socket.id);
        io.to(room.hostId).emit('listener-left', {
          listenerId: socket.id,
          participantCount: room.participants.length
        });
        
        // Notify all remaining listeners in the room about the updated count
        io.to(room.id).emit('participant-count-updated', {
          participantCount: room.participants.length
        });
        
        console.log(`User ${socket.id} left room ${room.id}`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`AudioParty server running on http://localhost:${PORT}`);
});
