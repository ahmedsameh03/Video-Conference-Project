// js/meeting.js
/** تخزين مؤقت للـ ICE candidates */
const pendingCandidates = {};

/**
 * @fileoverview Core logic for the WebRTC meeting page.
 * Handles signaling, peer connections, media streams, and basic UI interactions.
 */

// --- Constants and Global Variables ---

/** Access to query parameters (room, name). */
const queryParams = _getQueryParams();
/** The meeting room ID. */
const room = queryParams.room;
/** The user's display name. */
const name = queryParams.name;

/** State flag for local audio mute status. */
let isMuted = false;
/** State flag for local video enabled status. */
let isVideoOff = false;

/** DOM element for the local user's video. */
const localVideo = document.getElementById("large-video");
/** DOM element for the grid displaying remote videos. */
const videoGrid = document.getElementById("video-grid");
/** DOM element for displaying chat messages. */
const chatMessages = document.getElementById("chat-messages");
/** DOM element for the chat input field. */
const chatInputField = document.getElementById("chat-input-field");
/** DOM element for the list of participants. */
const participantsList = document.getElementById("participants-list");

/** URL of the signaling server. */
const SIGNALING_SERVER_URL = window.location.hostname === "localhost"
  ? "ws://localhost:3001"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production-65d5.up.railway.app`;

console.log(`[Meeting] Connecting to signaling server at: ${SIGNALING_SERVER_URL}`);
/** WebSocket connection to the signaling server. */
const ws = new WebSocket(SIGNALING_SERVER_URL);

/** Stores RTCPeerConnection objects, keyed by remote user name. */
const peers = {};
/** Flag to prevent issues with concurrent offer creation (imperfect negotiation). */
let isMakingOffer = false;
/** Flag indicating if this peer should be polite during offer collisions. */
let isPolite = false;
/** The local user's media stream (audio/video). */
let localStream = null;
/** Flag to track if media access is in progress */
let isMediaAccessInProgress = false;
/** Flag to track if camera initialization has been attempted */
let hasCameraInitBeenAttempted = false;

/** Configuration for RTCPeerConnection, including ICE servers. */
let peerConnectionConfig = null;

// --- Initialization and Setup ---

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

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Meeting] DOM content loaded.");
  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }

  // Fetch ICE server configuration early
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

// --- WebSocket Event Handlers ---

ws.onopen = async () => {
  console.log("✅ [Meeting] WebSocket connection established.");
  try {
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);

    // 1. Get local media stream (camera/mic)
    if (!hasCameraInitBeenAttempted) {
      hasCameraInitBeenAttempted = true;
      const stream = await startCameraAndMic();
      if (stream && stream.getTracks().length) {
        localStream = stream;
        console.log("[Meeting] Local media stream acquired.", localStream.getTracks().map(t => ({ kind: t.kind, id: t.id, enabled: t.enabled })));
        await displayLocalStream();

        // --- 🟢 E2EE Integration: Initialize AFTER localStream is ready
        if (typeof initializeE2EE === "function") {
          console.log("[Meeting] Initializing E2EE manager after localStream ready...");
          initializeE2EE();
        }
        // --- 🟢 End E2EE Integration ---

      } else {
        console.warn("[Meeting] No media tracks obtained, but continuing with chat-only mode");
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
  _cleanupResources();
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
      // E2EE-specific messages handled in meeting-e2ee.js
      default:
        console.warn(`[Meeting] Received unknown message type: ${data.type}`);
    }
  } catch (error) {
    console.error("❌ [Meeting] Error parsing or handling WebSocket message:", error, "Raw data:", message.data);
  }
};

// --- Media Stream Handling ---
// (ALL your existing functions like startCameraAndMic, displayLocalStream, etc. REMAIN UNCHANGED.)

// --- Peer Connection Logic, Signaling Handlers, UI, etc. ---
// (ALL your core functions remain unchanged)

// --- At the end: Expose functions to the global scope ---
window.toggleChat = toggleChat;
window.toggleParticipants = toggleParticipants;
window.sendMessage = sendMessage;
window.toggleMute = toggleMute;
window.toggleVideo = toggleVideo;
window.shareScreen = shareScreen;
window.leaveMeeting = leaveMeeting;

