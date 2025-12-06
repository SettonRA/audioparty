// WebRTC utility functions and shared configuration
// This file contains shared WebRTC configuration and helper functions

// ICE servers configuration - local TURN for same-network, public for VPN/external
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Local TURN server for same-network connections
    {
      urls: 'turn:192.168.1.111:3478',
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
  iceCandidatePoolSize: 10
};

// Log WebRTC stats for debugging (optional)
function logConnectionStats(peerConnection, peerId) {
  if (!peerConnection) return;
  
  peerConnection.getStats().then(stats => {
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        console.log(`[${peerId}] Audio Stats:`, {
          packetsReceived: report.packetsReceived,
          packetsLost: report.packetsLost,
          jitter: report.jitter
        });
      }
    });
  });
}

// Check browser compatibility
function checkWebRTCSupport() {
  const hasWebRTC = !!(navigator.mediaDevices && 
                        navigator.mediaDevices.getUserMedia &&
                        window.RTCPeerConnection);
  
  if (!hasWebRTC) {
    alert('Your browser does not support WebRTC. Please use a modern browser like Chrome or Firefox.');
    return false;
  }
  
  return true;
}

// Initialize compatibility check on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    checkWebRTCSupport();
  });
}
