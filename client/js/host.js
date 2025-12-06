// Host functionality - audio capture and streaming
let localStream = null;
let processedStream = null; // Stream with audio processing applied
const peerConnections = new Map(); // Map of listenerId -> RTCPeerConnection

// ICE servers configuration - local TURN for same-network, public for VPN/external
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Your TURN server (accessible locally and externally)
    {
      urls: 'turn:turn.cineclark.studio:3478',
      username: 'audioparty',
      credential: 'AudioParty2025!'
    },
    // Public TURN servers for VPN/external connections
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'relay' // Force TURN relay for testing
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

    // Apply audio normalization
    processedStream = await applyAudioNormalization(localStream);

    // Update UI
    document.getElementById('host-setup').classList.add('hidden');
    document.getElementById('host-streaming').classList.remove('hidden');

    // Initialize song detection
    if (typeof initializeSongDetection === 'function') {
      initializeSongDetection(localStream);
    }

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
  // Stop song detection
  if (typeof stopSongDetection === 'function') {
    stopSongDetection();
  }

  // Stop processed stream
  if (processedStream) {
    processedStream.getTracks().forEach(track => track.stop());
    processedStream = null;
  }

  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Close all peer connections
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
}

// Apply audio normalization to boost quiet audio
async function applyAudioNormalization(stream) {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  
  // Create a compressor to normalize volume levels
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-24, audioContext.currentTime); // Start compressing at -24dB
  compressor.knee.setValueAtTime(30, audioContext.currentTime); // Smooth compression curve
  compressor.ratio.setValueAtTime(12, audioContext.currentTime); // Strong compression ratio
  compressor.attack.setValueAtTime(0.003, audioContext.currentTime); // Fast attack
  compressor.release.setValueAtTime(0.25, audioContext.currentTime); // Medium release
  
  // Create a gain node to boost the overall level
  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(2.0, audioContext.currentTime); // Boost by 2x (6dB)
  
  // Connect the audio processing chain
  source.connect(compressor);
  compressor.connect(gainNode);
  
  // Create destination to capture the processed audio
  const destination = audioContext.createMediaStreamDestination();
  gainNode.connect(destination);
  
  console.log('Audio normalization applied: compression + 2x gain boost');
  
  return destination.stream;
}

// Handle new listener joining
socket.on('listener-joined', async (data) => {
  console.log('Listener joined:', data.listenerId);
  updateParticipantCount(data.participantCount);
  
  if (processedStream || localStream) {
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
  
  // Log ICE connection state changes
  pc.oniceconnectionstatechange = () => {
    console.log(`[${listenerId}] ICE connection state:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      console.error(`[${listenerId}] ICE connection failed!`);
    }
  };
  
  // Log connection state changes
  pc.onconnectionstatechange = () => {
    console.log(`[${listenerId}] Connection state:`, pc.connectionState);
  };

  // Add processed audio stream to peer connection (or fall back to local stream)
  const streamToSend = processedStream || localStream;
  const audioTracks = streamToSend.getAudioTracks();
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
      console.log(`Sending ICE candidate to ${listenerId}:`, {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
        address: event.candidate.address,
        port: event.candidate.port,
        priority: event.candidate.priority
      });
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

// Discord sharing functionality
let discordSharingEnabled = false;
const shareDiscordBtn = document.getElementById('share-discord-btn');

if (shareDiscordBtn) {
  shareDiscordBtn.addEventListener('click', () => {
    if (discordSharingEnabled) {
      // Already enabled, don't allow toggling off
      return;
    }
    
    discordSharingEnabled = true;
    
    // Get room code from the displayed text
    const roomCode = document.getElementById('host-room-code').textContent;
    
    console.log('Discord button clicked, enabled:', discordSharingEnabled, 'room:', roomCode);
    
    shareDiscordBtn.textContent = '✅ Sharing on Discord';
    shareDiscordBtn.classList.add('active');
    shareDiscordBtn.disabled = true;
    shareDiscordBtn.style.cursor = 'not-allowed';
    socket.emit('enable-discord-sharing', { roomId: roomCode });
    console.log('Emitted enable-discord-sharing for room:', roomCode);
  });
} else {
  console.error('Share Discord button not found!');
}
