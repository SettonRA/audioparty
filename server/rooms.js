class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(hostId) {
    const roomId = this.generateRoomId();
    const room = {
      id: roomId,
      hostId: hostId,
      participants: [hostId],
      createdAt: Date.now(),
      discordSharingEnabled: false,
      currentSong: null
    };
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomByParticipant(participantId) {
    for (const room of this.rooms.values()) {
      if (room.participants.includes(participantId)) {
        return room;
      }
    }
    return null;
  }

  addParticipant(roomId, participantId) {
    const room = this.rooms.get(roomId);
    if (room && !room.participants.includes(participantId)) {
      room.participants.push(participantId);
    }
    return room;
  }

  removeParticipant(roomId, participantId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.participants = room.participants.filter(id => id !== participantId);
      
      // Delete room if empty
      if (room.participants.length === 0) {
        this.rooms.delete(roomId);
      }
    }
    return room;
  }

  deleteRoom(roomId) {
    return this.rooms.delete(roomId);
  }

  updateCurrentSong(roomId, song) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.currentSong = song;
    }
    return room;
  }

  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  generateRoomId() {
    // Generate a simple 6-character room code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Ensure uniqueness
    if (this.rooms.has(code)) {
      return this.generateRoomId();
    }
    
    return code;
  }
}

module.exports = RoomManager;
