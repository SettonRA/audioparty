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
