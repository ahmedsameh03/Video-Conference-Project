// meeting.js - Fixed getUserMedia Timeout
const queryParams = getQueryParams();
const room = queryParams.room;
const name = queryParams.name;

let localStream = null;
let isMuted = false;
let isVideoOff = false;

const peers = {};
const localVideo = document.getElementById("large-video");

// WebSocket with error handling
const SIGNALING_SERVER_URL = window.location.hostname === "localhost"
  ? "ws://localhost:3001"
  : `wss://video-conference-project-production-65d5.up.railway.app`;

let ws = new WebSocket(SIGNALING_SERVER_URL);

// Enhanced getUserMedia with multiple fallbacks
async function startCamera() {
  console.log('🎥 Starting camera with enhanced fallbacks...');
  
  // Stop any existing stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  const constraints = [
    // High quality
    { video: { width: 1280, height: 720, frameRate: 30 }, audio: true },
    // Medium quality
    { video: { width: 640, height: 480, frameRate: 15 }, audio: true },
    // Low quality
    { video: { width: 320, height: 240, frameRate: 10 }, audio: true },
    // Video only
    { video: { width: 320, height: 240 }, audio: false },
    // Audio only
    { video: false, audio: true }
  ];

  for (let i = 0; i < constraints.length; i++) {
    try {
      console.log(`🔄 Camera attempt ${i + 1}:`, constraints[i]);
      
      // Add timeout to getUserMedia
      const mediaPromise = navigator.mediaDevices.getUserMedia(constraints[i]);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getUserMedia timeout')), 10000)
      );
      
      localStream = await Promise.race([mediaPromise, timeoutPromise]);
      
      console.log(`✅ Camera success with attempt ${i + 1}`);
      
      // Set up video element
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      
      try {
        await localVideo.play();
        console.log('✅ Video playback started');
      } catch (playError) {
        console.warn('⚠️ Video play warning:', playError);
      }
      
      return localStream;
      
    } catch (error) {
      console.error(`❌ Attempt ${i + 1} failed:`, error.name, error.message);
      
      if (error.name === 'AbortError') {
        // Wait longer for AbortError
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  
  throw new Error('All camera attempts failed');
}

// Fixed WebSocket connection
ws.onopen = async () => {
  console.log('✅ WebSocket connected');
  
  try {
    await startCamera();
    
    if (!localStream) {
      throw new Error('No media stream available');
    }
    
    console.log('📹 Media ready, joining room...');
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    
  } catch (error) {
    console.error('❌ Media initialization failed:', error);
    alert('Failed to access camera/microphone. Please check permissions.');
  }
};

// Fixed WebSocket error handling (const assignment issue)
ws.onerror = (error) => {
  console.error('❌ WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('🔌 WebSocket closed:', event.code, event.reason);
  // Don't reassign ws here - that causes the const error
  setTimeout(() => {
    if (ws.readyState === WebSocket.CLOSED) {
      console.log('🔄 Attempting to reconnect...');
      // Create new WebSocket instead of reassigning
      connectWebSocket();
    }
  }, 5000);
};

function connectWebSocket() {
  ws = new WebSocket(SIGNALING_SERVER_URL);
  // Re-attach event handlers
  ws.onopen = async () => { /* ... */ };
  ws.onerror = (error) => { /* ... */ };
  ws.onclose = (event) => { /* ... */ };
}

// Rest of your WebRTC peer connection code...
async function createPeer(user) {
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });
  
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }
  
  return peer;
}

// Helper function for query params
function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    room: params.get('room') || 'default-room',
    name: params.get('name') || 'Anonymous'
  };
}
