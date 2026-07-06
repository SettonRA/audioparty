'use strict';

const SERVER_URL = 'https://audioparty.cineclark.studio';

// --- Connection state ---
const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
let localStream     = null;
let processedStream = null;
let gainAudioContext = null;
let currentRoomCode = null;
const peerConnections = new Map();

let iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 10 };

fetch(`${SERVER_URL}/api/ice-servers`)
  .then(r => r.json())
  .then(cfg => { iceServers = { ...cfg, iceCandidatePoolSize: 10 }; })
  .catch(() => {});

// --- Screen management ---
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// --- App version ---
window.electronAPI.getVersion().then(v => {
  document.getElementById('app-version').textContent = `v${v}`;
});

// --- Socket connection status ---
socket.on('connect', () => {
  const el = document.getElementById('server-status');
  el.textContent = '🟢 Connected';
  el.className = 'status-badge connected';
  document.getElementById('host-btn').disabled = false;
});

socket.on('disconnect', () => {
  const el = document.getElementById('server-status');
  el.textContent = '🔴 Disconnected';
  el.className = 'status-badge disconnected';
  document.getElementById('host-btn').disabled = true;

  if (localStream) {
    stopHosting();
    alert('Lost connection to server. The party has ended.');
    showScreen('home-screen');
  }
});

// --- Home screen ---
document.getElementById('host-btn').addEventListener('click', async () => {
  await loadAudioSources();
  showScreen('source-screen');
});

// --- Source selection ---
document.getElementById('back-from-sources-btn').addEventListener('click', () => {
  showScreen('home-screen');
});

async function loadAudioSources() {
  const list = document.getElementById('source-list');
  list.innerHTML = '<li class="source-loading">Loading sources...</li>';

  try {
    const sources = await window.electronAPI.getAudioSources();
    list.innerHTML = '';

    // Screens first — best for capturing all system audio
    const screens = sources.filter(s =>
      /screen|entire|display/i.test(s.name)
    );
    const windows = sources.filter(s => !screens.includes(s));

    if (screens.length > 0) {
      appendGroupHeader(list, '🖥 Entire Screen (captures all system audio)');
      screens.forEach(s => appendSourceItem(list, s, '🖥'));
    }

    if (windows.length > 0) {
      appendGroupHeader(list, '🪟 Application Windows');
      windows.slice(0, 20).forEach(s => appendSourceItem(list, s, '🪟'));
    }

    if (sources.length === 0) {
      list.innerHTML = '<li class="source-empty">No sources found.</li>';
    }
  } catch (err) {
    list.innerHTML = `<li class="source-empty">Failed to load sources: ${escapeHtml(String(err.message))}</li>`;
  }
}

function appendGroupHeader(list, label) {
  const li = document.createElement('li');
  li.className = 'source-group-header';
  li.textContent = label;
  list.appendChild(li);
}

function appendSourceItem(list, source, icon) {
  const li = document.createElement('li');
  li.className = 'source-item';
  li.innerHTML = `<span class="source-icon">${icon}</span><span class="source-name">${escapeHtml(source.name)}</span>`;
  li.addEventListener('click', () => startHosting(source.id, source.name));
  list.appendChild(li);
}

// --- Hosting ---
async function startHosting(sourceId, sourceName) {
  showScreen('loading-screen');
  document.getElementById('loading-text').textContent = `Capturing audio from "${sourceName}"...`;

  try {
    // Electron-specific: capture audio from a desktop/window source.
    // Video constraint is required by Chromium when using chromeMediaSource: 'desktop'.
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      },
      video: {
        mandatory: { chromeMediaSource: 'desktop' }
      }
    });

    // Discard video — audio only
    localStream.getVideoTracks().forEach(t => t.stop());

    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('No audio captured. Make sure audio is playing on the selected source.');
    }

    // Apply gain boost (same as web version)
    processedStream = applyGain(localStream);

    // Start song detection (same as web version)
    initializeSongDetection(localStream);

    // Create a room on the server
    document.getElementById('loading-text').textContent = 'Creating room...';
    socket.emit('create-room', (response) => {
      if (!response.success) {
        stopHosting();
        alert('Failed to create room. Please try again.');
        showScreen('home-screen');
        return;
      }

      currentRoomCode = response.roomId;
      document.getElementById('room-code-display').textContent = currentRoomCode;
      document.getElementById('participant-count').textContent = '1';
      showScreen('hosting-screen');
    });

    // If the source stops (e.g., app closed), end the party
    audioTracks[0].addEventListener('ended', () => {
      stopHosting();
      alert('Audio source stopped. The party has ended.');
      showScreen('home-screen');
    });

  } catch (err) {
    stopHosting();
    alert(`Could not capture audio:\n${err.message}`);
    showScreen('source-screen');
  }
}

function stopHosting() {
  stopSongDetection();

  if (processedStream) {
    processedStream.getTracks().forEach(t => t.stop());
    processedStream = null;
  }
  if (gainAudioContext) {
    gainAudioContext.close();
    gainAudioContext = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  currentRoomCode = null;

  // Reset song display and Discord button for next party
  const songContainer = document.getElementById('current-song-display');
  if (songContainer) {
    songContainer.innerHTML = '<div class="song-info"><div class="song-status">🎵 Listening for songs...</div></div>';
  }
  const discordBtn = document.getElementById('share-discord-btn');
  if (discordBtn) {
    discordSharingEnabled = false;
    discordBtn.textContent = '📢 Share on Discord';
    discordBtn.classList.remove('active');
    discordBtn.disabled = false;
  }
}

// --- Hosting screen controls ---
document.getElementById('copy-code-btn').addEventListener('click', async () => {
  if (!currentRoomCode) return;
  await navigator.clipboard.writeText(currentRoomCode);
  flashButton('copy-code-btn', 'Copy Code', '✓ Copied!');
});

document.getElementById('copy-link-btn').addEventListener('click', async () => {
  if (!currentRoomCode) return;
  await navigator.clipboard.writeText(`${SERVER_URL}/${currentRoomCode}`);
  flashButton('copy-link-btn', 'Copy Link', '✓ Copied!');
});

document.getElementById('end-party-btn').addEventListener('click', () => {
  stopHosting();
  showScreen('home-screen');
});

// --- Discord sharing ---
let discordSharingEnabled = false;
const shareDiscordBtn = document.getElementById('share-discord-btn');

if (shareDiscordBtn) {
  shareDiscordBtn.addEventListener('click', () => {
    if (discordSharingEnabled || !currentRoomCode) return;

    discordSharingEnabled = true;
    shareDiscordBtn.textContent = '✅ Sharing on Discord';
    shareDiscordBtn.classList.add('active');
    shareDiscordBtn.disabled = true;
    socket.emit('enable-discord-sharing', { roomId: currentRoomCode });
  });
}

function flashButton(id, original, flash) {
  const btn = document.getElementById(id);
  btn.textContent = flash;
  setTimeout(() => { btn.textContent = original; }, 2000);
}

// --- Participant updates ---
socket.on('participant-count-updated', ({ participantCount }) => {
  document.getElementById('participant-count').textContent = participantCount;
});

// --- WebRTC signaling ---
socket.on('listener-joined', async ({ listenerId, participantCount }) => {
  document.getElementById('participant-count').textContent = participantCount;
  if (processedStream || localStream) await createPeerConnection(listenerId);
});

socket.on('listener-left', ({ listenerId, participantCount }) => {
  document.getElementById('participant-count').textContent = participantCount;
  const pc = peerConnections.get(listenerId);
  if (pc) { pc.close(); peerConnections.delete(listenerId); }
});

socket.on('answer', async ({ sender, answer }) => {
  const pc = peerConnections.get(sender);
  if (pc) {
    try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch {}
  }
});

socket.on('ice-candidate', async ({ sender, candidate }) => {
  const pc = peerConnections.get(sender);
  if (pc && candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
});

async function createPeerConnection(listenerId) {
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(listenerId, pc);

  const streamToSend = processedStream || localStream;
  streamToSend.getAudioTracks().forEach(track => {
    const sender = pc.addTrack(track, localStream);
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0].maxBitrate  = 510000; // 510 kbps high-quality audio
    params.encodings[0].priority    = 'high';
    sender.setParameters(params).catch(() => {});
  });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { target: listenerId, candidate });
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) {
      pc.close();
      peerConnections.delete(listenerId);
    }
  };

  try {
    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: listenerId, offer });
  } catch (err) {
    console.error('Failed to create offer for', listenerId, err);
    pc.close();
    peerConnections.delete(listenerId);
  }
}

// --- Audio gain (same 3x boost as web version) ---
function applyGain(stream) {
  gainAudioContext = new AudioContext();
  const source = gainAudioContext.createMediaStreamSource(stream);
  const gain   = gainAudioContext.createGain();
  gain.gain.value = 3.0;
  const dest = gainAudioContext.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(dest);
  return dest.stream;
}

// --- Song detection (same approach as web version) ---
let sdAudioContext       = null;
let sdAnalyserNode       = null;
let sdDetectionInterval  = null;
let sdMonitorInterval    = null;
let sdIsActive           = false;
let sdLastSong           = null;
let sdWasSilent          = false;
let sdSilenceStartTime   = null;
let sdLastDetectionTime  = 0;
const SD_SILENCE_THRESHOLD    = 0.01;
const SD_MIN_SILENCE_DURATION = 2000;
const SD_MIN_DETECTION_INTERVAL = 15000;

function initializeSongDetection(stream) {
  if (!stream) return;

  try {
    sdAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = sdAudioContext.createMediaStreamSource(stream);
    sdAnalyserNode = sdAudioContext.createAnalyser();
    source.connect(sdAnalyserNode);
    sdAnalyserNode.fftSize = 2048;

    sdIsActive = true;
    setTimeout(() => detectCurrentSong(), 5000);
    startSongAudioMonitoring();

    sdDetectionInterval = setInterval(() => {
      if (Date.now() - sdLastDetectionTime > 45000) detectCurrentSong();
    }, 60000);
  } catch (err) {
    console.error('Failed to initialize song detection:', err);
  }
}

function startSongAudioMonitoring() {
  if (sdMonitorInterval) return;

  const bufferLength = sdAnalyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  sdMonitorInterval = setInterval(() => {
    if (!sdAnalyserNode) return;

    sdAnalyserNode.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / bufferLength);
    const isSilent = rms < SD_SILENCE_THRESHOLD;
    const now = Date.now();

    if (isSilent && !sdWasSilent) {
      sdSilenceStartTime = now;
      sdWasSilent = true;
    } else if (!isSilent && sdWasSilent) {
      const silenceDuration = now - sdSilenceStartTime;
      const timeSinceLastDetection = now - sdLastDetectionTime;

      if (silenceDuration >= SD_MIN_SILENCE_DURATION && timeSinceLastDetection >= SD_MIN_DETECTION_INTERVAL) {
        setTimeout(() => detectCurrentSong(), 3000);
      }

      sdWasSilent = false;
      sdSilenceStartTime = null;
    }
  }, 500);
}

function stopSongDetection() {
  sdIsActive = false;

  if (sdDetectionInterval) { clearInterval(sdDetectionInterval); sdDetectionInterval = null; }
  if (sdMonitorInterval)   { clearInterval(sdMonitorInterval); sdMonitorInterval = null; }
  if (sdAudioContext && sdAudioContext.state !== 'closed') {
    sdAudioContext.close();
    sdAudioContext = null;
  }

  sdAnalyserNode = null;
  sdLastSong = null;
  sdWasSilent = false;
  sdSilenceStartTime = null;
}

async function detectCurrentSong() {
  if (!sdAudioContext || !sdAnalyserNode || !localStream) return;

  try {
    if (!sdLastSong) updateSongDisplay({ status: 'detecting' });

    const audioData = await captureAudioSample(10);
    if (!audioData) {
      updateSongDisplay({ status: 'error', message: 'Failed to capture audio' });
      return;
    }

    const response = await fetch(`${SERVER_URL}/api/identify-song`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioData })
    });

    const result = await response.json();

    if (result.success && result.song) {
      sdLastSong = result.song;
      sdLastDetectionTime = Date.now();
      updateSongDisplay({ status: 'success', song: result.song });

      socket.emit('song-detected', { roomId: currentRoomCode, song: result.song });
    } else if (!sdLastSong) {
      updateSongDisplay({ status: 'not-found', message: result.message || 'No match found' });
    }
  } catch (err) {
    console.error('Song detection error:', err);
    if (!sdLastSong) updateSongDisplay({ status: 'error', message: 'Detection failed' });
  }
}

function captureAudioSample(durationSeconds) {
  return new Promise((resolve) => {
    if (!localStream) { resolve(null); return; }

    try {
      const audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack) { resolve(null); return; }

      const audioStream = new MediaStream([audioTrack]);
      const chunks = [];
      const mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        } catch {
          resolve(null);
        }
      };

      mediaRecorder.onerror = () => resolve(null);

      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, durationSeconds * 1000);
    } catch {
      resolve(null);
    }
  });
}

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

// --- Utility ---
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, c => map[c]);
}
