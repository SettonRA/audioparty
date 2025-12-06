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
  }
});

const PORT = process.env.PORT || 3000;
const roomManager = new RoomManager();
const acrCloudService = new ACRCloudService();

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
    if (!acrCloudService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Song recognition not configured'
      });
    }

    const { audioData } = req.body;
    
    if (!audioData) {
      return res.status(400).json({
        success: false,
        error: 'No audio data provided'
      });
    }

    // Convert base64 audio data to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // Identify the song
    const result = await acrCloudService.identify(audioBuffer);
    
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

// Song recognition endpoint
app.post('/api/identify-song', async (req, res) => {
  try {
    if (!acrCloudService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Song recognition not configured'
      });
    }

    const { audioData } = req.body;
    
    if (!audioData) {
      return res.status(400).json({
        success: false,
        error: 'No audio data provided'
      });
    }

    // Convert base64 audio data to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // Identify the song
    const result = await acrCloudService.identify(audioBuffer);
    
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
    callback({ success: true, roomId: room.id });
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
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const room = roomManager.getRoomByParticipant(socket.id);
    
    if (room) {
      if (room.hostId === socket.id) {
        // Host left - notify all participants and close room
        io.to(room.id).emit('host-disconnected');
        
        // Update Discord to show party ended (only if sharing was enabled)
        if (room.discordSharingEnabled) {
          discordService.partyEnded(room.id);
        }
        
        roomManager.deleteRoom(room.id);
        console.log(`Room ${room.id} closed - host disconnected`);
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
