// Song detection functionality for host
let songDetectionInterval = null;
let audioContext = null;
let analyserNode = null;
let isDetectionActive = false;
let lastDetectedSong = null;
let audioMonitorInterval = null;
let wasSilent = false;
let silenceStartTime = null;
let lastDetectionTime = 0;
const SILENCE_THRESHOLD = 0.01; // Audio level threshold for silence
const MIN_SILENCE_DURATION = 2000; // 2 seconds of silence before triggering
const MIN_DETECTION_INTERVAL = 15000; // Minimum 15 seconds between detections

// Initialize song detection when streaming starts
function initializeSongDetection(stream) {
  if (!stream) return;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    
    source.connect(analyserNode);
    analyserNode.fftSize = 2048;

    console.log('Song detection initialized');
    
    // Start smart detection with silence monitoring
    startSmartDetection();
  } catch (error) {
    console.error('Failed to initialize song detection:', error);
  }
}

// Start smart detection with silence monitoring
function startSmartDetection() {
  if (isDetectionActive) return;
  
  isDetectionActive = true;
  
  // Detect immediately
  setTimeout(() => detectCurrentSong(), 5000); // Wait 5 seconds for audio to stabilize
  
  // Start monitoring audio levels for silence detection
  startAudioMonitoring();
  
  // Fallback: Also check every 60 seconds in case silence detection misses something
  songDetectionInterval = setInterval(() => {
    const timeSinceLastDetection = Date.now() - lastDetectionTime;
    // Only auto-detect if it's been more than 45 seconds since last detection
    if (timeSinceLastDetection > 45000) {
      console.log('Fallback detection triggered (60s interval)');
      detectCurrentSong();
    }
  }, 60000);
  
  console.log('Smart song detection started (silence detection + 60s fallback)');
}

// Monitor audio levels to detect silence (song changes)
function startAudioMonitoring() {
  if (audioMonitorInterval) return;
  
  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  audioMonitorInterval = setInterval(() => {
    if (!analyserNode) return;
    
    // Get current audio level
    analyserNode.getByteTimeDomainData(dataArray);
    
    // Calculate RMS (root mean square) for audio level
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / bufferLength);
    
    const isSilent = rms < SILENCE_THRESHOLD;
    const now = Date.now();
    
    if (isSilent && !wasSilent) {
      // Silence just started
      silenceStartTime = now;
      wasSilent = true;
    } else if (!isSilent && wasSilent) {
      // Audio resumed after silence
      const silenceDuration = now - silenceStartTime;
      const timeSinceLastDetection = now - lastDetectionTime;
      
      if (silenceDuration >= MIN_SILENCE_DURATION && timeSinceLastDetection >= MIN_DETECTION_INTERVAL) {
        console.log(`Silence detected (${(silenceDuration/1000).toFixed(1)}s) - triggering song detection`);
        // Wait 3 seconds for new song to start before detecting
        setTimeout(() => detectCurrentSong(), 3000);
      }
      
      wasSilent = false;
      silenceStartTime = null;
    }
  }, 500); // Check every 500ms
  
  console.log('Audio level monitoring started');
}

// Stop automatic detection
function stopSongDetection() {
  isDetectionActive = false;
  
  if (songDetectionInterval) {
    clearInterval(songDetectionInterval);
    songDetectionInterval = null;
  }
  
  if (audioMonitorInterval) {
    clearInterval(audioMonitorInterval);
    audioMonitorInterval = null;
  }
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  
  analyserNode = null;
  lastDetectedSong = null;
  wasSilent = false;
  silenceStartTime = null;
  
  console.log('Song detection stopped');
}

// Capture and detect current song
async function detectCurrentSong() {
  if (!audioContext || !analyserNode || !localStream) {
    console.log('Song detection not ready');
    return;
  }

  try {
    // Only show detecting status if no song has been detected yet
    if (!lastDetectedSong) {
      updateSongDisplay({ status: 'detecting' });
    }
    
    // Capture 10 seconds of audio
    const audioData = await captureAudioSample(10);
    
    if (!audioData) {
      console.log('Failed to capture audio sample');
      updateSongDisplay({ status: 'error', message: 'Failed to capture audio' });
      return;
    }

    // Send to server for identification
    const response = await fetch('/api/identify-song', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ audioData })
    });

    const result = await response.json();
    
    if (result.success && result.song) {
      lastDetectedSong = result.song;
      lastDetectionTime = Date.now(); // Track when detection occurred
      updateSongDisplay({ status: 'success', song: result.song });
      
      // Broadcast to all listeners in the room
      socket.emit('song-detected', {
        roomId: currentRoomCode,
        song: result.song
      });
      
      console.log('Song detected:', result.song.title, '-', result.song.artist);
    } else {
      console.log('No song match found');
      // Only show "not found" if no previous song exists, otherwise keep showing last song
      if (!lastDetectedSong) {
        updateSongDisplay({ status: 'not-found', message: result.message || 'No match found' });
      }
    }
  } catch (error) {
    console.error('Song detection error:', error);
    // Only show error if no previous song exists, otherwise keep showing last song
    if (!lastDetectedSong) {
      updateSongDisplay({ status: 'error', message: 'Detection failed' });
    }
  }
}

// Capture audio sample from stream using MediaRecorder
function captureAudioSample(durationSeconds) {
  return new Promise((resolve, reject) => {
    if (!localStream) {
      console.error('No localStream available');
      resolve(null);
      return;
    }

    try {
      // Use MediaRecorder to capture audio
      const audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack) {
        console.error('No audio track found');
        resolve(null);
        return;
      }

      // Create a new stream with just the audio track
      const audioStream = new MediaStream([audioTrack]);
      
      const chunks = [];
      const mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          
          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            resolve(base64data);
          };
          reader.onerror = () => {
            console.error('FileReader error');
            resolve(null);
          };
          reader.readAsDataURL(blob);
        } catch (error) {
          console.error('Error processing recorded audio:', error);
          resolve(null);
        }
      };

      mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        resolve(null);
      };

      // Start recording
      mediaRecorder.start();
      console.log('Started audio capture for', durationSeconds, 'seconds');

      // Stop after specified duration
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          console.log('Stopped audio capture');
        }
      }, durationSeconds * 1000);

    } catch (error) {
      console.error('Error capturing audio sample:', error);
      resolve(null);
    }
  });
}

// Update song display UI
function updateSongDisplay(data) {
  const container = document.getElementById('current-song-display');
  if (!container) return;

  if (data.status === 'detecting') {
    container.innerHTML = `
      <div class="song-info detecting">
        <div class="song-status">🎵 Detecting song...</div>
      </div>
    `;
  } else if (data.status === 'success' && data.song) {
    const song = data.song;
    container.innerHTML = `
      <div class="song-info">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
        ${song.album ? `<div class="song-album">${escapeHtml(song.album)}</div>` : ''}
      </div>
    `;
  } else if (data.status === 'not-found') {
    container.innerHTML = `
      <div class="song-info not-found">
        <div class="song-status">🎵 No song detected</div>
      </div>
    `;
  } else if (data.status === 'error') {
    container.innerHTML = `
      <div class="song-info error">
        <div class="song-status">❌ ${escapeHtml(data.message || 'Detection error')}</div>
      </div>
    `;
  }
}

// Escape HTML to prevent XSS
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

// Manual song detection button
document.getElementById('detect-song-btn')?.addEventListener('click', () => {
  detectCurrentSong();
});
