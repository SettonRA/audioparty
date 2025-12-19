// Listener functionality - receive and play audio stream
let peerConnection = null;
let hostId = null;
const remoteAudio = document.getElementById('remote-audio');
let iceCandidateQueue = [];
let listenerAudioContext = null;
let listenerGainNode = null;

// Volume control
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');

volumeSlider.addEventListener('input', (e) => {
  const volume = e.target.value;
  remoteAudio.volume = volume / 100;
  volumeValue.textContent = volume + '%';
});

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
  
  // Monitor ICE connection state
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      console.error('ICE connection failed!');
      // Log the local and remote descriptions for debugging
      console.log('Local description:', peerConnection.localDescription);
      console.log('Remote description:', peerConnection.remoteDescription);
    }
  };
  
  // Monitor overall connection state
  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
  };

  // Handle incoming audio track
  peerConnection.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind, 'readyState:', event.track.readyState);
    if (event.track.kind === 'audio') {
      console.log('Setting audio srcObject, stream:', event.streams[0].id);
      
      // Use direct audio stream without gain processing for Chrome compatibility
      remoteAudio.srcObject = event.streams[0];
      console.log('Using direct audio stream (no gain boost)');
      
      // Function to start audio playback
      const startPlayback = async () => {
        try {
          // Attempt to play
          await remoteAudio.play();
          console.log('Audio playing successfully');
          
          // Update UI to show playing state
          document.getElementById('listener-connecting').classList.add('hidden');
          document.getElementById('listener-playing').classList.remove('hidden');
          document.getElementById('connection-status').textContent = '🟢 Connected';
          document.getElementById('connection-status').classList.add('connected');
          
          // Set initial volume
          remoteAudio.volume = volumeSlider.value / 100;
          
        } catch (err) {
          console.error('Error playing audio:', err);
          
          if (err.name === 'NotAllowedError') {
            console.log('Autoplay blocked by browser, waiting for user interaction...');
            
            // Update UI to indicate click needed
            document.getElementById('listener-connecting').classList.add('hidden');
            document.getElementById('listener-playing').classList.remove('hidden');
            document.getElementById('connection-status').textContent = '🟡 Click to unmute';
            document.getElementById('connection-status').style.color = '#fb923c';
            
            // Add click handler to entire document for easier activation
            const activateAudio = async () => {
              try {
                await remoteAudio.play();
                console.log('Audio started after user interaction');
                
                document.getElementById('connection-status').textContent = '🟢 Connected';
                document.getElementById('connection-status').classList.add('connected');
                document.getElementById('connection-status').style.color = '';
                
                remoteAudio.volume = volumeSlider.value / 100;
                
                document.removeEventListener('click', activateAudio);
              } catch (retryErr) {
                console.error('Failed to start audio after user interaction:', retryErr);
              }
            };
            
            document.addEventListener('click', activateAudio, { once: true });
          } else {
            // For other errors, still show the UI
            document.getElementById('listener-connecting').classList.add('hidden');
            document.getElementById('listener-playing').classList.remove('hidden');
          }
        }
      };
      
      // Start playback
      startPlayback();
    }
  };
                }
                await remoteAudio.play();
                console.log('Audio started after user interaction');
                
                document.getElementById('connection-status').textContent = '🟢 Connected';
                document.getElementById('connection-status').classList.add('connected');
                document.getElementById('connection-status').style.color = '';
                
                remoteAudio.volume = volumeSlider.value / 100;
                
                document.removeEventListener('click', activateAudio);
              } catch (retryErr) {
                console.error('Failed to start audio after user interaction:', retryErr);
              }
            };
            
            document.addEventListener('click', activateAudio, { once: true });
          } else {
            // For other errors, still show the UI
            document.getElementById('listener-connecting').classList.add('hidden');
            document.getElementById('listener-playing').classList.remove('hidden');
          }
        }
      };
      
      // Start playback
      startPlayback();
    }
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate to host:', {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
        address: event.candidate.address,
        port: event.candidate.port,
        priority: event.candidate.priority,
        candidate: event.candidate.candidate
      });
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
