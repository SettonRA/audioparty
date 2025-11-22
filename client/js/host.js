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

// Handle server disconnect
socket.on('disconnect', () => {
  if (localStream) {
    console.log('Server disconnected while hosting');
    stopStreaming();
    alert('Lost connection to server. Your party has ended.');
    setTimeout(() => location.reload(), 1000);
  }
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
        autoGainControl: false,
        sampleRate: 48000,
        sampleSize: 16,
        channelCount: 2
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
});

async function createPeerConnection(listenerId) {
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(listenerId, pc);

  // Add local audio stream to peer connection
  const audioTracks = localStream.getAudioTracks();
  console.log(`Adding ${audioTracks.length} audio tracks to peer connection for:`, listenerId);
  audioTracks.forEach(track => {
    const sender = pc.addTrack(track, localStream);
    console.log('Added track:', track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
    
    // Set encoding parameters for higher quality
    const params = sender.getParameters();
    if (!params.encodings) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = 510000; // 510 kbps for high quality audio
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    sender.setParameters(params).catch(err => console.log('Failed to set encoding params:', err));
  });

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate to ${listenerId}:`, event.candidate.type);
      socket.emit('ice-candidate', {
        target: listenerId,
        candidate: event.candidate
      });
    } else {
      console.log('ICE gathering complete for:', listenerId);
    }
  };

  // Monitor connection state
  pc.onconnectionstatechange = () => {
    console.log(`[${listenerId}] Connection state:`, pc.connectionState);
  };
  
  pc.oniceconnectionstatechange = () => {
    console.log(`[${listenerId}] ICE connection state:`, pc.iceConnectionState);
  };

  // Prefer Opus codec with high quality settings
  const transceivers = pc.getTransceivers();
  transceivers.forEach(transceiver => {
    if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === 'audio') {
      const capabilities = RTCRtpSender.getCapabilities('audio');
      if (capabilities && capabilities.codecs) {
        // Prefer Opus with maximum quality
        const opusCodec = capabilities.codecs.find(codec => 
          codec.mimeType === 'audio/opus' && codec.sdpFmtpLine && codec.sdpFmtpLine.includes('stereo=1')
        ) || capabilities.codecs.find(codec => codec.mimeType === 'audio/opus');
        
        if (opusCodec) {
          transceiver.setCodecPreferences([opusCodec]);
          console.log('Set Opus codec preference with stereo');
        }
      }
    }
  });

  // Create and send offer
  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    await pc.setLocalDescription(offer);
    console.log('Local description set for:', listenerId);
    
    socket.emit('offer', {
      target: listenerId,
      offer: offer
    });
    
    console.log('Offer sent to:', listenerId);
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

// Handle answer from listener
socket.on('answer', async (data) => {
  console.log('Received answer from:', data.sender);
  const pc = peerConnections.get(data.sender);
  if (pc) {
    try {
      console.log('Setting remote description for:', data.sender);
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      console.log('Answer accepted from:', data.sender);
    } catch (error) {
      console.error('Error setting remote description:', error);
    }
  }
});

// Handle ICE candidates from listener
socket.on('ice-candidate', async (data) => {
  console.log('Received ICE candidate from:', data.sender);
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
