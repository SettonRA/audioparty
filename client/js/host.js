// Host functionality - audio capture and streaming
let localStream = null;
let processedStream = null;
let hostAudioContext = null;
let hostGainNode = null;
const peerConnections = new Map(); // Map of listenerId -> RTCPeerConnection

// ICE servers configuration - fetched from server
let iceServers = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  iceCandidatePoolSize: 10
};

// Fetch ICE server configuration from server
fetch('/api/ice-servers')
  .then(res => res.json())
  .then(config => {
    iceServers = { ...config, iceCandidatePoolSize: 10 };
    console.log('Loaded ICE server configuration:', iceServers);
  })
  .catch(err => console.error('Failed to load ICE servers:', err));

// Initialize host controls when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHostControls);
} else {
  initHostControls();
}

function initHostControls() {
  const startBtn = document.getElementById('start-streaming-btn');
  const stopBtn = document.getElementById('stop-streaming-btn');
  const cancelBtn = document.getElementById('cancel-host-btn');
  
  console.log('Initializing host controls, start button:', startBtn, 'stop button:', stopBtn);
  
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      console.log('Start streaming button clicked');
      
      try {
        await startAudioCapture();
      } catch (error) {
        console.error('Error starting audio capture:', error);
        alert('Failed to capture audio. Make sure you selected a tab and enabled "Share audio".');
      }
    });
  }
  
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      stopStreaming();
      location.reload();
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      location.href = '/';
    });
  }
}

// Check TURN server status
async function checkTurnStatus() {
  const statusElement = document.getElementById('turn-status');
  if (!statusElement) return;
  
  try {
    const response = await fetch('/api/turn-status');
    const status = await response.json();
    
    if (status.available) {
      statusElement.textContent = '🟢 Relay: Online';
      statusElement.title = `TURN server (${status.server}) is reachable`;
      statusElement.style.color = '#4ade80';
    } else {
      statusElement.textContent = '🔴 Relay: Offline';
      statusElement.title = status.message;
      statusElement.style.color = '#f87171';
    }
  } catch (error) {
    statusElement.textContent = '⚠️ Relay: Error';
    statusElement.title = 'Failed to check TURN server status';
    statusElement.style.color = '#fb923c';
  }
}

// Check TURN status when host screen is shown
const hostScreenObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    const hostScreen = document.getElementById('host-screen');
    if (hostScreen && !hostScreen.classList.contains('hidden')) {
      checkTurnStatus();
      // Re-check every 30 seconds while hosting
      const statusInterval = setInterval(() => {
        if (hostScreen.classList.contains('hidden')) {
          clearInterval(statusInterval);
        } else {
          checkTurnStatus();
        }
      }, 30000);
    }
  });
});

// Start observing when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const hostScreen = document.getElementById('host-screen');
    if (hostScreen) {
      hostScreenObserver.observe(hostScreen, { attributes: true, attributeFilter: ['class'] });
    }
  });
} else {
  const hostScreen = document.getElementById('host-screen');
  if (hostScreen) {
    hostScreenObserver.observe(hostScreen, { attributes: true, attributeFilter: ['class'] });
  }
}

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

    // Apply gain control
    processedStream = applyGainControl(localStream);

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

  // Close audio context
  if (hostAudioContext) {
    hostAudioContext.close();
    hostAudioContext = null;
    hostGainNode = null;
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

function applyGainControl(stream) {
  hostAudioContext = new AudioContext();
  const source = hostAudioContext.createMediaStreamSource(stream);
  
  hostGainNode = hostAudioContext.createGain();
  hostGainNode.gain.value = 5.0; // Fixed 5x gain boost
  
  const destination = hostAudioContext.createMediaStreamDestination();
  source.connect(hostGainNode);
  hostGainNode.connect(destination);
  
  console.log('Applied gain control: 5.0x boost');
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

  // Add audio stream to peer connection (use processed stream if available)
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
