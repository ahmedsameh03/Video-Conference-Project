// js/meeting.js

// ----------------- GLOBAL VARIABLES -----------------
const pendingCandidates = {};

const queryParams = _getQueryParams();
const room = queryParams.room;
const name = queryParams.name;

let isMuted = false;
let isVideoOff = false;

const localVideo = document.getElementById("large-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");

const SIGNALING_SERVER_URL = window.location.hostname === "localhost"
  ? "ws://localhost:3001"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production-65d5.up.railway.app`;

console.log(`[Meeting] Connecting to signaling server at: ${SIGNALING_SERVER_URL}`);
const ws = new WebSocket(SIGNALING_SERVER_URL);

const peers = {};
let isMakingOffer = false;
let isPolite = false;
let localStream = null;
let isMediaAccessInProgress = false;
let hasCameraInitBeenAttempted = false;
let peerConnectionConfig = null;

// --------------- UTILITIES & HELPERS -----------------
function _getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}

async function _fetchIceServers() {
  console.log("[Meeting] Fetching updated Xirsys ICE servers...");
  return [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:fr-turn7.xirsys.com:3478",
        "turn:fr-turn7.xirsys.com:80?transport=udp",
        "turn:fr-turn7.xirsys.com:80?transport=tcp",
        "turn:fr-turn7.xirsys.com:443?transport=tcp",
        "turns:fr-turn7.xirsys.com:5349?transport=tcp"
      ],
      username: "L2a-fvFXKem5bHUHPf_WEX4oi-Ixl0BHHXuz4z_7KSgyjpfxuzhcVM2Tu_DfwOTUAAAAAGgpFR1haG1lZHNhbWVoMDM=",
      credential: "c3c10bb4-3372-11f0-a269-fadfa0afc433"
    }
  ];
}

// ----------------- UI EVENT LISTENERS -----------------
function _setupUIEventListeners() {
  // Add your actual event listeners here as in your original code.
  // Example:
  // document.getElementById("mute-btn").addEventListener("click", toggleMute);
}

// --------------- CORE MEETING FUNCTIONS ---------------

function addParticipant(participantName) {
  // Add logic to show participant in the list/grid if needed
}

function handleNewUser(remoteName) {
  if (remoteName === name) return; // Don't connect to yourself

  // Only create a new connection if not already present
  if (peers[remoteName]) return;

  const pc = new RTCPeerConnection(peerConnectionConfig);

  // Add local stream tracks to the new peer connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Handle incoming remote tracks
  pc.ontrack = (event) => {
    let remoteVideo = document.getElementById(`remote-video-${remoteName}`);
    if (!remoteVideo) {
      remoteVideo = document.createElement('video');
      remoteVideo.id = `remote-video-${remoteName}`;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      remoteVideo.muted = false;
      videoGrid.appendChild(remoteVideo);
    }
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.muted = false;
  };

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "candidate",
        user: remoteName,
        candidate: event.candidate
      }));
    }
  };

  peers[remoteName] = pc;

  // Send offer to the new user
  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => {
      ws.send(JSON.stringify({
        type: "offer",
        user: remoteName,
        offer: pc.localDescription
      }));
    });

  // Handle remote answer/offer/candidate will be handled below
}

function handleOffer(user, offer) {
  if (user === name) return;

  let pc = peers[user];
  if (!pc) {
    pc = new RTCPeerConnection(peerConnectionConfig);

    // Add local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Setup remote track
    pc.ontrack = (event) => {
      let remoteVideo = document.getElementById(`remote-video-${user}`);
      if (!remoteVideo) {
        remoteVideo = document.createElement('video');
        remoteVideo.id = `remote-video-${user}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false;
        videoGrid.appendChild(remoteVideo);
      }
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.muted = false;
    };

    // ICE candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({
          type: "candidate",
          user: user,
          candidate: event.candidate
        }));
      }
    };

    peers[user] = pc;
  }

  pc.setRemoteDescription(new RTCSessionDescription(offer)).then(() => {
    return pc.createAnswer();
  }).then(answer => {
    return pc.setLocalDescription(answer);
  }).then(() => {
    ws.send(JSON.stringify({
      type: "answer",
      user: user,
      answer: pc.localDescription
    }));
  });
}

function handleAnswer(user, answer) {
  if (user === name) return;
  const pc = peers[user];
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

function handleCandidate(user, candidate) {
  if (user === name) return;
  const pc = peers[user];
  if (pc && candidate) {
    pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function handleUserLeft(user) {
  if (user === name) return;
  const pc = peers[user];
  if (pc) {
    pc.close();
    delete peers[user];
    const remoteVideo = document.getElementById(`remote-video-${user}`);
    if (remoteVideo && remoteVideo.parentNode) {
      remoteVideo.parentNode.removeChild(remoteVideo);
    }
  }
}

function handleChatMessage(user, text) {
  // Logic for displaying chat message
}

function toggleChat() {
  // Your original chat toggle logic
}

function toggleParticipants() {
  // Your original participants toggle logic
}

function sendMessage() {
  // Your send message logic
}

function toggleMute() {
  // Your mute logic
}

function toggleVideo() {
  // Your video toggle logic
}

function shareScreen() {
  // Your screen share logic
}

function leaveMeeting() {
  // Logic for leaving the meeting
}

function _showMediaErrorMessage(msg) {
  // Display error to user about camera/mic issues
}

async function startCameraAndMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    isMediaAccessInProgress = false;
    return stream;
  } catch (err) {
    isMediaAccessInProgress = false;
    _showMediaErrorMessage("Failed to access camera/microphone.");
    return null;
  }
}

async function displayLocalStream() {
  if (localVideo && localStream) {
    localVideo.srcObject = localStream;
    localVideo.muted = true; // Prevent echo!
    await localVideo.play();
    console.log("[Meeting] Local video playback started successfully.");
  }
}

// ------------- MAIN INITIALIZATION SEQUENCE -------------

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Meeting] DOM content loaded.");

  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }

  try {
    peerConnectionConfig = { iceServers: await _fetchIceServers() };
    console.log("[Meeting] ICE server configuration loaded.");
  } catch (error) {
    console.error("❌ [Meeting] Failed to fetch ICE servers:", error);
    alert("Error fetching network configuration (ICE servers). Peer connections might fail.");
    peerConnectionConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  }

  _setupUIEventListeners();
});

// --------------- WEBSOCKET HANDLERS -------------------

ws.onopen = async () => {
  console.log("✅ [Meeting] WebSocket connection established.");
  try {
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);

    if (!hasCameraInitBeenAttempted) {
      hasCameraInitBeenAttempted = true;
      const stream = await startCameraAndMic();
      if (stream && stream.getTracks().length) {
        localStream = stream;
        console.log("[Meeting] Local media stream acquired.", localStream.getTracks().map(t => ({ kind: t.kind, id: t.id, enabled: t.enabled })));
        await displayLocalStream();

        // 🟢 E2EE order fix: Initialize after localStream is ready
        if (typeof initializeE2EE === "function") {
          console.log("[Meeting] Initializing E2EE manager after localStream ready...");
          initializeE2EE();
        }

      } else {
        _showMediaErrorMessage("No camera or microphone available. You can still chat and see others.");
      }
    }
  } catch (error) {
    console.error("❌ [Meeting] Error during WebSocket open sequence:", error);
    _showMediaErrorMessage("Failed to access camera/microphone. You can still chat and see others.");
  }
};

ws.onerror = (error) => {
  console.error("❌ [Meeting] WebSocket Error:", error);
  alert("WebSocket connection error. Please check the server status and your network connection.");
};

ws.onclose = (event) => {
  console.log(`🔌 [Meeting] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || "."}, Clean: ${event.wasClean}`);
  if (!event.wasClean) {
    alert("WebSocket connection closed unexpectedly. Please try refreshing the page.");
  }
  // Call your cleanup logic here.
};

ws.onmessage = async (message) => {
  let data;
  try {
    data = JSON.parse(message.data);
    if (!data || !data.type) {
        console.warn("[Meeting] Received invalid WebSocket message (no type):", data);
        return;
    }

    switch (data.type) {
      case "new-user":
        handleNewUser(data.user);
        break;
      case "offer":
        handleOffer(data.user, data.offer);
        break;
      case "answer":
        handleAnswer(data.user, data.answer);
        break;
      case "candidate":
        handleCandidate(data.user, data.candidate);
        break;
      case "user-left":
        handleUserLeft(data.user);
        break;
      case "chat":
        handleChatMessage(data.user, data.text);
        break;
      default:
        console.warn(`[Meeting] Received unknown message type: ${data.type}`);
    }
  } catch (error) {
    console.error("❌ [Meeting] Error parsing or handling WebSocket message:", error, "Raw data:", message.data);
  }
};

// ----------- EXPORTS FOR HTML UI BUTTONS ---------------
window.toggleChat = toggleChat;
window.toggleParticipants = toggleParticipants;
window.sendMessage = sendMessage;
window.toggleMute = toggleMute;
window.toggleVideo = toggleVideo;
window.shareScreen = shareScreen;
window.leaveMeeting = leaveMeeting;

// --------------- END OF FILE ---------------------------
