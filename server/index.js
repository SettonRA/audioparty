const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const RoomManager = require('./rooms');

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
  socket.on('join-room', (roomId, callback) => {
    const room = roomManager.getRoom(roomId);
    
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (room.participants.length >= 5) {
      callback({ success: false, error: 'Room is full (max 5 participants)' });
      return;
    }

    if (room.participants.includes(socket.id)) {
      callback({ success: false, error: 'Already in this room' });
      return;
    }

    roomManager.addParticipant(roomId, socket.id);
    socket.join(roomId);
    
    // Notify host that a listener joined
    io.to(room.hostId).emit('listener-joined', {
      listenerId: socket.id,
      participantCount: room.participants.length
    });

    console.log(`User ${socket.id} joined room ${roomId}`);
    callback({ 
      success: true, 
      hostId: room.hostId,
      participantCount: room.participants.length 
    });
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
    console.log(`ICE candidate from ${socket.id} to ${data.target}`);
    io.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const room = roomManager.getRoomByParticipant(socket.id);
    
    if (room) {
      if (room.hostId === socket.id) {
        // Host left - notify all participants and close room
        io.to(room.id).emit('host-disconnected');
        roomManager.deleteRoom(room.id);
        console.log(`Room ${room.id} closed - host disconnected`);
      } else {
        // Listener left - notify host
        roomManager.removeParticipant(room.id, socket.id);
        io.to(room.hostId).emit('listener-left', {
          listenerId: socket.id,
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
