// Listener functionality - receive and play audio stream
let peerConnection = null;
let hostId = null;
const remoteAudio = document.getElementById('remote-audio');
let iceCandidateQueue = [];
let listenerAudioContext = null;
let gainNode = null;

// Volume control
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');

if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const volume = e.target.value;
    if (volumeValue) {
      volumeValue.textContent = volume + '%';
    }
    
    // Use Web Audio API for volume control to support >100%
    if (gainNode && listenerAudioContext) {
      gainNode.gain.setValueAtTime(volume / 100, listenerAudioContext.currentTime);
    }
  });
}

// Leave party button
document.getElementById('leave-party-btn').addEventListener('click', () => {
  disconnectFromParty();
  // Redirect to home page instead of reload to avoid auto-rejoin
  window.location.href = '/';
});

function initListener(receivedHostId) {
  console.log('initListener called with hostId:', receivedHostId);
  hostId = receivedHostId;
  console.log('hostId set to:', hostId);
  setupPeerConnection();
}

function setupPeerConnection() {
  peerConnection = new RTCPeerConnection(iceServers);

  // Monitor ICE gathering state
  peerConnection.onicegatheringstatechange = () => {
    console.log('ICE gathering state:', peerConnection.iceGatheringState);
  };

  // Handle incoming audio track
  peerConnection.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind, 'readyState:', event.track.readyState);
    if (event.track.kind === 'audio') {
      console.log('Setting audio srcObject, stream:', event.streams[0].id);
      
      // Set up Web Audio API for volume control >100%
      listenerAudioContext = new AudioContext();
      const source = listenerAudioContext.createMediaStreamSource(event.streams[0]);
      gainNode = listenerAudioContext.createGain();
      
      // Set initial volume from slider (default to 0.8 if slider not found)
      const initialVolume = volumeSlider ? (volumeSlider.value / 100) : 0.8;
      gainNode.gain.setValueAtTime(initialVolume, listenerAudioContext.currentTime);
      
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Set srcObject for potential browser controls (muted by default, Web Audio handles playback)
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.volume = 0; // Mute the HTML5 audio element
      
      // Ensure autoplay works
      remoteAudio.play().then(() => {
        console.log('Audio playing successfully with Web Audio API volume control');
        
        // Update UI to show playing state
        document.getElementById('listener-connecting').classList.add('hidden');
        document.getElementById('listener-playing').classList.remove('hidden');
        document.getElementById('connection-status').textContent = '🟢 Connected';
        document.getElementById('connection-status').classList.add('connected');
      }).catch(err => {
        console.error('Error playing audio:', err);
        // Try to show playing state anyway
        document.getElementById('listener-connecting').classList.add('hidden');
        document.getElementById('listener-playing').classList.remove('hidden');
      });
    }
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate to host:', event.candidate.type);
      socket.emit('ice-candidate', {
        target: hostId,
        candidate: event.candidate
      });
    } else {
      console.log('ICE gathering complete');
    }
  };

  // Handle connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    
    switch (peerConnection.connectionState) {
      case 'connected':
        document.getElementById('connection-status').textContent = '🟢 Connected';
        document.getElementById('connection-status').classList.add('connected');
        break;
      case 'disconnected':
      case 'failed':
        showError('Connection lost');
        break;
      case 'closed':
        console.log('Connection closed');
        break;
    }
  };

  // Handle ICE connection state
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    
    if (peerConnection.iceConnectionState === 'failed') {
      showError('Failed to establish connection');
    }
  };
}

// Handle offer from host
socket.on('offer', async (data) => {
  console.log('Received offer from host');
  
  if (!peerConnection) {
    console.error('Peer connection not initialized');
    showError('Connection not ready');
    return;
  }
  
  try {
    console.log('Setting remote description...');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    console.log('Remote description set successfully');
    
    // Process any queued ICE candidates
    if (iceCandidateQueue.length > 0) {
      console.log(`Processing ${iceCandidateQueue.length} queued ICE candidates`);
      for (const candidate of iceCandidateQueue) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Error adding queued ICE candidate:', err);
        }
      }
      iceCandidateQueue = [];
    }
    
    console.log('Creating answer...');
    const answer = await peerConnection.createAnswer();
    console.log('Setting local description...');
    await peerConnection.setLocalDescription(answer);
    console.log('Local description set successfully');
    
    socket.emit('answer', {
      target: hostId,
      answer: answer
    });
    
    console.log('Answer sent to host:', hostId);
  } catch (error) {
    console.error('Error handling offer:', error);
    showError('Failed to establish connection: ' + error.message);
  }
});

// Handle ICE candidates from host
socket.on('ice-candidate', async (data) => {
  console.log('Received ICE candidate, sender:', data.sender);
  
  if (peerConnection) {
    // If remote description not set yet, queue the candidate
    if (!peerConnection.remoteDescription) {
      console.log('Queueing ICE candidate - remote description not set yet');
      iceCandidateQueue.push(data.candidate);
      return;
    }
    
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      console.log('ICE candidate added successfully');
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  } else {
    console.log('Ignoring ICE candidate - no peer connection');
  }
});

function disconnectFromParty() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (remoteAudio.srcObject) {
    remoteAudio.srcObject.getTracks().forEach(track => track.stop());
    remoteAudio.srcObject = null;
  }
}

// Listen for song updates from host
socket.on('song-update', (data) => {
  console.log('Received song update:', data.song);
  updateListenerSongDisplay(data.song);
});

// Update song display for listeners
function updateListenerSongDisplay(song) {
  const container = document.getElementById('listener-song-display');
  if (!container) return;

  if (song) {
    container.innerHTML = `
      <div class="song-info">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
        ${song.album ? `<div class="song-album">${escapeHtml(song.album)}</div>` : ''}
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="song-info">
        <div class="song-status">🎵 Waiting for song info...</div>
      </div>
    `;
  }
}

// Escape HTML helper (shared with song-detection.js)
if (typeof escapeHtml === 'undefined') {
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}
