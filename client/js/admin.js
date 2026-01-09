// Admin panel functionality
let refreshInterval;

async function loadSessions() {
  try {
    const response = await fetch('/api/admin/sessions');
    
    if (response.status === 401) {
      // Auth required - browser will handle basic auth prompt
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to load sessions');
    }

    const data = await response.json();
    displaySessions(data.sessions);
  } catch (error) {
    console.error('Error loading sessions:', error);
    showError('Failed to load sessions. Please refresh the page.');
  }
}

function displaySessions(sessions) {
  const container = document.getElementById('sessions-container');
  const noSessions = document.getElementById('no-sessions');
  const sessionCount = document.getElementById('session-count');

  // Update count
  sessionCount.textContent = `${sessions.length} Active Session${sessions.length !== 1 ? 's' : ''}`;

  // Show/hide appropriate content
  if (sessions.length === 0) {
    container.classList.add('hidden');
    noSessions.classList.remove('hidden');
    return;
  }

  noSessions.classList.add('hidden');
  container.classList.remove('hidden');

  // Build session cards
  container.innerHTML = sessions.map(session => createSessionCard(session)).join('');

  // Add event listeners to end session buttons
  document.querySelectorAll('.btn-end-session').forEach(btn => {
    btn.addEventListener('click', () => endSession(btn.dataset.roomId, btn));
  });
}

function createSessionCard(session) {
  const uptime = getUptime(session.createdAt);
  const songHtml = session.currentSong
    ? `<div class="song-info">
        <div class="song-title">🎵 ${escapeHtml(session.currentSong.title)}</div>
        <div class="song-artist">${escapeHtml(session.currentSong.artist)}</div>
       </div>`
    : `<div class="song-info"><div class="no-song">No song detected yet</div></div>`;

  const discordBadge = session.discordSharing
    ? '<span class="badge badge-discord">Discord Sharing</span>'
    : '';

  return `
    <div class="session-card">
      <div class="session-header">
        <div class="session-id">${session.roomId}</div>
        <div class="participant-count">👥 ${session.participantCount}</div>
      </div>

      <div class="session-info">
        <div class="info-row">
          <span class="info-label">Host ID:</span>
          <span class="info-value">${session.hostId.substring(0, 12)}...</span>
        </div>
        <div class="info-row">
          <span class="info-label">Uptime:</span>
          <span class="info-value uptime">${uptime}</span>
        </div>
      </div>

      ${songHtml}

      ${discordBadge ? `<div class="session-badges">${discordBadge}</div>` : ''}

      <div class="session-actions">
        <button class="btn-end-session" data-room-id="${session.roomId}">
          🛑 End Session
        </button>
      </div>
    </div>
  `;
}

async function endSession(roomId, button) {
  if (!confirm(`Are you sure you want to end session ${roomId}?`)) {
    return;
  }

  button.disabled = true;
  button.textContent = 'Ending...';

  try {
    const response = await fetch('/api/admin/end-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ roomId })
    });

    if (!response.ok) {
      throw new Error('Failed to end session');
    }

    // Reload sessions after a short delay
    setTimeout(loadSessions, 500);
  } catch (error) {
    console.error('Error ending session:', error);
    alert('Failed to end session. Please try again.');
    button.disabled = false;
    button.textContent = '🛑 End Session';
  }
}

function getUptime(createdAt) {
  const now = Date.now();
  const diff = now - createdAt;
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  const container = document.getElementById('sessions-container');
  container.innerHTML = `
    <div style="background: rgba(220, 53, 69, 0.1); color: #dc3545; padding: 20px; border-radius: 10px; text-align: center;">
      <strong>Error:</strong> ${message}
    </div>
  `;
}

// Event listeners
document.getElementById('refresh-btn').addEventListener('click', loadSessions);

// Initial load
loadSessions();

// Auto-refresh every 5 seconds
refreshInterval = setInterval(loadSessions, 5000);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
