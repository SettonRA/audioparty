// WebRTC utility functions and shared configuration
// This file contains shared WebRTC configuration and helper functions

// ICE servers configuration (STUN servers for NAT traversal, TURN servers for relay)
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // TURN servers for NAT traversal when STUN isn't sufficient
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
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
