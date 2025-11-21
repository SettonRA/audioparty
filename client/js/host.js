// Host functionality - audio capture and streaming
let localStream = null;
const peerConnections = new Map(); // Map of listenerId -> RTCPeerConnection

// ICE servers configuration (using public STUN servers)
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Start streaming button
document.getElementById('start-streaming-btn').addEventListener('click', async () => {
  try {
    await startAudioCapture();
  } catch (error) {
    console.error('Error starting audio capture:', error);
    alert('Failed to capture audio. Make sure you selected a tab and enabled "Share audio".');
  }
});

// Stop streaming button
document.getElementById('stop-streaming-btn').addEventListener('click', () => {
  stopStreaming();
  location.reload();
});

async function startAudioCapture() {
  try {
    // Request screen/tab sharing with audio
    // Note: Some browsers require video:true even if we only want audio
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // Required by some browsers
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    // Check if audio track exists
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('No audio track found. Please make sure to check "Share audio" when selecting the tab.');
    }

    console.log('Audio capture started:', audioTracks[0].label);

    // Hide video track (we don't need it displayed)
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => track.stop());

    // Update UI
    document.getElementById('host-setup').classList.add('hidden');
    document.getElementById('host-streaming').classList.remove('hidden');

    // Handle stream end (user stops sharing)
    localStream.getAudioTracks()[0].addEventListener('ended', () => {
      console.log('Audio track ended');
      stopStreaming();
      alert('Screen sharing stopped. The party has ended.');
      location.reload();
    });

  } catch (error) {
    throw error;
  }
}

function stopStreaming() {
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Close all peer connections
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
}

// Handle new listener joining
socket.on('listener-joined', async (data) => {
  console.log('Listener joined:', data.listenerId);
  updateParticipantCount(data.participantCount);
  
  if (localStream) {
    await createPeerConnection(data.listenerId);
  }
});

// Handle listener leaving
socket.on('listener-left', (data) => {
  console.log('Listener left:', data.listenerId);
  updateParticipantCount(data.participantCount);
  
  const pc = peerConnections.get(data.listenerId);
  if (pc) {
    pc.close();
    peerConnections.delete(data.listenerId);
  }
  
  updateListenersList();
});

async function createPeerConnection(listenerId) {
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(listenerId, pc);

  // Add local audio stream to peer connection
  localStream.getAudioTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        target: listenerId,
        candidate: event.candidate
      });
    }
  };

  // Create and send offer
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
      target: listenerId,
      offer: offer
    });
    
    console.log('Offer sent to:', listenerId);
  } catch (error) {
    console.error('Error creating offer:', error);
  }

  updateListenersList();
}

// Handle answer from listener
socket.on('answer', async (data) => {
  const pc = peerConnections.get(data.sender);
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      console.log('Answer received from:', data.sender);
    } catch (error) {
      console.error('Error setting remote description:', error);
    }
  }
});

// Handle ICE candidates from listener
socket.on('ice-candidate', async (data) => {
  const pc = peerConnections.get(data.sender);
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }
});

function updateParticipantCount(count) {
  document.getElementById('host-participant-count').textContent = count;
}

function updateListenersList() {
  const listenersList = document.getElementById('listeners-list');
  const connectedListeners = Array.from(peerConnections.keys());
  
  if (connectedListeners.length === 0) {
    listenersList.innerHTML = '<li class="empty-state">Waiting for listeners to join...</li>';
  } else {
    listenersList.innerHTML = connectedListeners
      .map((id, index) => `<li>Listener ${index + 1} <span class="status-dot"></span></li>`)
      .join('');
  }
}
