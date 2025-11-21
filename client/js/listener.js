// Listener functionality - receive and play audio stream
let peerConnection = null;
let hostId = null;
const remoteAudio = document.getElementById('remote-audio');

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
  location.reload();
});

function initListener(receivedHostId) {
  hostId = receivedHostId;
  setupPeerConnection();
}

function setupPeerConnection() {
  peerConnection = new RTCPeerConnection(iceServers);

  // Handle incoming audio track
  peerConnection.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    if (event.track.kind === 'audio') {
      remoteAudio.srcObject = event.streams[0];
      
      // Update UI to show playing state
      document.getElementById('listener-connecting').classList.add('hidden');
      document.getElementById('listener-playing').classList.remove('hidden');
      document.getElementById('connection-status').textContent = '🟢 Connected';
      document.getElementById('connection-status').classList.add('connected');
      
      // Set initial volume
      remoteAudio.volume = volumeSlider.value / 100;
    }
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        target: hostId,
        candidate: event.candidate
      });
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
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    console.log('Remote description set');
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log('Local description set');
    
    socket.emit('answer', {
      target: hostId,
      answer: answer
    });
    
    console.log('Answer sent to host');
  } catch (error) {
    console.error('Error handling offer:', error);
    showError('Failed to establish connection: ' + error.message);
  }
});

// Handle ICE candidates from host
socket.on('ice-candidate', async (data) => {
  if (data.sender === hostId && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
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
