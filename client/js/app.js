// Main application state and UI controller
const socket = io();

const screens = {
  landing: document.getElementById('landing-screen'),
  host: document.getElementById('host-screen'),
  listener: document.getElementById('listener-screen')
};

let currentMode = null; // 'host' or 'listener'
let pendingRoomCode = null;

// Check for room code in URL path on load
window.addEventListener('DOMContentLoaded', () => {
  const pathParts = window.location.pathname.split('/').filter(p => p);
  console.log('URL path parts:', pathParts);
  
  if (pathParts.length > 0) {
    const roomCode = pathParts[0].toUpperCase();
    console.log('Checking room code:', roomCode);
    
    // Validate it's a 6-character alphanumeric code
    if (/^[A-Z0-9]{6}$/.test(roomCode)) {
      console.log('Valid room code detected, switching to listener mode');
      pendingRoomCode = roomCode;
      currentMode = 'listener';
      showScreen('listener');
      
      // Wait for socket to connect before joining
      if (socket.connected) {
        console.log('Socket already connected, joining immediately');
        joinRoom(roomCode);
        pendingRoomCode = null;
      } else {
        console.log('Socket not connected yet, waiting...');
      }
    }
  }
});

// Handle socket connection
socket.on('connect', () => {
  console.log('Connected to server');
  // If we have a pending room code from URL, join now
  if (pendingRoomCode) {
    joinRoom(pendingRoomCode);
    pendingRoomCode = null;
  }
});

// Landing screen controls
document.getElementById('host-btn').addEventListener('click', () => {
  currentMode = 'host';
  showScreen('host');
  createRoom();
});

document.getElementById('join-btn').addEventListener('click', () => {
  document.getElementById('join-form').classList.remove('hidden');
  document.getElementById('host-btn').disabled = true;
  document.getElementById('join-btn').disabled = true;
});

document.getElementById('join-cancel-btn').addEventListener('click', () => {
  document.getElementById('join-form').classList.add('hidden');
  document.getElementById('room-code-input').value = '';
  document.getElementById('host-btn').disabled = false;
  document.getElementById('join-btn').disabled = false;
});

document.getElementById('join-submit-btn').addEventListener('click', () => {
  const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (roomCode.length === 6) {
    currentMode = 'listener';
    showScreen('listener');
    joinRoom(roomCode);
  } else {
    alert('Please enter a valid 6-character room code');
  }
});

// Allow Enter key to submit room code
document.getElementById('room-code-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('join-submit-btn').click();
  }
});

// Back to home button
document.getElementById('back-to-home-btn').addEventListener('click', () => {
  location.reload();
});

// Utility functions
function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  screens[screenName].classList.add('active');
}

function createRoom() {
  socket.emit('create-room', (response) => {
    if (response.success) {
      const roomCode = response.roomId;
      document.getElementById('host-room-code').textContent = roomCode;
      document.getElementById('share-code').textContent = roomCode;
      
      // Update share link
      const shareUrl = `${window.location.origin}/${roomCode}`;
      document.getElementById('share-link').value = shareUrl;
      
      console.log('Room created:', roomCode);
    } else {
      alert('Failed to create room. Please try again.');
      showScreen('landing');
    }
  });
}

function joinRoom(roomCode) {
  console.log('Attempting to join room:', roomCode);
  socket.emit('join-room', roomCode);
}

// Listen for join-room response
socket.on('join-room-response', (response) => {
  console.log('join-room-response received');
  console.log('Response:', JSON.stringify(response, null, 2));
  
  if (response && response.success) {
    const roomCode = response.roomId;
    document.getElementById('listener-room-code').textContent = roomCode;
    document.getElementById('listener-participant-count').textContent = response.participantCount || '-';
    console.log('Joined room:', roomCode, 'Host ID:', response.hostId);
    
    if (!response.hostId) {
      console.error('ERROR: hostId is missing from response!');
      showError('Server error: missing host information');
      return;
    }
    
    // Listener logic will handle connection
    initListener(response.hostId);
  } else {
    const errorMsg = response.error || 'Failed to join room';
    console.error('Join room failed:', errorMsg);
    showError(errorMsg);
  }
});

// Listen for participant count updates
socket.on('participant-count-updated', (data) => {
  if (currentMode === 'listener') {
    console.log('Participant count updated:', data.participantCount);
    document.getElementById('listener-participant-count').textContent = data.participantCount;
  }
});

function showError(message) {
  document.getElementById('listener-connecting').classList.add('hidden');
  document.getElementById('listener-playing').classList.add('hidden');
  document.getElementById('listener-error').classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

// Copy link button
document.getElementById('copy-link-btn').addEventListener('click', async () => {
  const linkInput = document.getElementById('share-link');
  const copyBtn = document.getElementById('copy-link-btn');
  
  try {
    await navigator.clipboard.writeText(linkInput.value);
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    // Fallback for browsers that don't support clipboard API
    linkInput.select();
    document.execCommand('copy');
    copyBtn.textContent = 'Copied!';
    
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  }
});

// Socket event handlers
socket.on('disconnect', () => {
  console.log('Disconnected from server');
  if (currentMode === 'host') {
    alert('Lost connection to server. Your party has ended. Please refresh to start a new party.');
  } else if (currentMode === 'listener') {
    showError('Lost connection to server');
  }
});

// Handle reconnection
socket.on('connect', () => {
  console.log('Connected/Reconnected to server');
  // If we have a pending room code from URL, join now
  if (pendingRoomCode) {
    joinRoom(pendingRoomCode);
    pendingRoomCode = null;
  }
});

socket.on('host-disconnected', () => {
  if (currentMode === 'listener') {
    showError('Host ended the party');
  }
});
