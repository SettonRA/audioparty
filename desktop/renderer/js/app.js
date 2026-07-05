'use strict';

const SERVER_URL = 'https://audioparty.cineclark.studio';

// --- Connection state ---
const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
let localStream     = null;
let processedStream = null;
let audioContext    = null;
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
      document.getElementById('share-url').textContent = `${SERVER_URL}/${currentRoomCode}`;
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
  if (processedStream) {
    processedStream.getTracks().forEach(t => t.stop());
    processedStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  currentRoomCode = null;
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
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const gain   = audioContext.createGain();
  gain.gain.value = 3.0;
  const dest = audioContext.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(dest);
  return dest.stream;
}

// --- Utility ---
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, c => map[c]);
}
