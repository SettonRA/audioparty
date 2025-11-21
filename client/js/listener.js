// Listener functionality - receive and play audio stream
let peerConnection = null;
let hostId = null;
const remoteAudio = document.getElementById('remote-audio');
let iceCandidateQueue = [];

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
  console.log('initListener called with hostId:', receivedHostId);
  hostId = receivedHostId;
  console.log('hostId set to:', hostId);
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
  console.log('Received ICE candidate from host, sender:', data.sender, 'expected:', hostId);
  
  if (data.sender === hostId && peerConnection) {
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
    console.log('Ignoring ICE candidate - no peer connection or wrong sender');
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
