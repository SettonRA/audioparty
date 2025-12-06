// WebRTC utility functions and shared configuration
// This file contains shared WebRTC configuration and helper functions

// Note: ICE servers are now loaded from /api/ice-servers endpoint
// This file is kept for utility functions only

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
