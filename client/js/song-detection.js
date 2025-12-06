// Song detection functionality for host
let songDetectionInterval = null;
let audioContext = null;
let analyserNode = null;
let isDetectionActive = false;
let lastDetectedSong = null;

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
    
    // Start automatic detection every 30 seconds
    startAutomaticDetection();
  } catch (error) {
    console.error('Failed to initialize song detection:', error);
  }
}

// Start automatic song detection
function startAutomaticDetection() {
  if (isDetectionActive) return;
  
  isDetectionActive = true;
  
  // Detect immediately
  setTimeout(() => detectCurrentSong(), 5000); // Wait 5 seconds for audio to stabilize
  
  // Then detect every 30 seconds
  songDetectionInterval = setInterval(() => {
    detectCurrentSong();
  }, 30000);
  
  console.log('Automatic song detection started');
}

// Stop automatic detection
function stopSongDetection() {
  isDetectionActive = false;
  
  if (songDetectionInterval) {
    clearInterval(songDetectionInterval);
    songDetectionInterval = null;
  }
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  
  analyserNode = null;
  lastDetectedSong = null;
  
  console.log('Song detection stopped');
}

// Capture and detect current song
async function detectCurrentSong() {
  if (!audioContext || !analyserNode || !localStream) {
    console.log('Song detection not ready');
    return;
  }

  try {
    // Show detecting status
    updateSongDisplay({ status: 'detecting' });
    
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
      updateSongDisplay({ status: 'success', song: result.song });
      
      // Broadcast to all listeners in the room
      socket.emit('song-detected', {
        roomId: currentRoomCode,
        song: result.song
      });
      
      console.log('Song detected:', result.song.title, '-', result.song.artist);
    } else {
      console.log('No song match found');
      updateSongDisplay({ status: 'not-found', message: result.message || 'No match found' });
    }
  } catch (error) {
    console.error('Song detection error:', error);
    updateSongDisplay({ status: 'error', message: 'Detection failed' });
  }
}

// Capture audio sample from stream
function captureAudioSample(durationSeconds) {
  return new Promise((resolve) => {
    if (!audioContext || !localStream) {
      resolve(null);
      return;
    }

    try {
      const sampleRate = 16000; // ACRCloud prefers 16kHz
      const numChannels = 1; // Mono
      const bufferSize = sampleRate * durationSeconds;
      
      const offlineContext = new OfflineAudioContext(numChannels, bufferSize, sampleRate);
      const source = offlineContext.createMediaStreamSource(localStream);
      source.connect(offlineContext.destination);

      // Start recording
      offlineContext.startRendering().then(buffer => {
        // Convert AudioBuffer to WAV format
        const wavData = audioBufferToWav(buffer);
        const base64Data = arrayBufferToBase64(wavData);
        resolve(base64Data);
      }).catch(error => {
        console.error('Error rendering audio:', error);
        resolve(null);
      });

      // Timeout after duration + 2 seconds
      setTimeout(() => {
        resolve(null);
      }, (durationSeconds + 2) * 1000);
    } catch (error) {
      console.error('Error capturing audio sample:', error);
      resolve(null);
    }
  });
}

// Convert AudioBuffer to WAV format
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const data = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    data.push(buffer.getChannelData(i));
  }
  
  const length = buffer.length * numChannels * bytesPerSample;
  const wav = new ArrayBuffer(44 + length);
  const view = new DataView(wav);
  
  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);
  
  // Write audio data
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, data[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return wav;
}

// Helper function to write string to DataView
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
