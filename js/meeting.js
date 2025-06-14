// js/meeting.js

/**
 * @fileoverview Core logic for the WebRTC meeting page.
 * Handles signaling, peer connections, media streams, and basic UI interactions.
 */

// --- Constants and Global Variables ---

// Acknowledgment: This implementation relies heavily on global variables for state management.
// While suitable for this demo, larger applications might benefit from more structured state management (e.g., classes, modules, state libraries).

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

<<<<<<< HEAD
/** 
 * URL of the signaling server. 
 * NOTE: In a production environment, this should be configurable (e.g., via environment variables or a config file)
 * rather than hardcoded based on hostname.
 */
const SIGNALING_SERVER_URL = window.location.hostname === "localhost"
  ? "ws://localhost:3001" // Local development
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production-65d5.up.railway.app`; // Production (Example)
=======
const SIGNALING_SERVER_URL =
  "wss://video-conference-project-production-65d5.up.railway.app";
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01

console.log(`[Meeting] Connecting to signaling server at: ${SIGNALING_SERVER_URL}`);
/** WebSocket connection to the signaling server. */
const ws = new WebSocket(SIGNALING_SERVER_URL);

/** Stores RTCPeerConnection objects, keyed by remote user name. */
const peers = {};
/** Flag to prevent issues with concurrent offer creation (imperfect negotiation). */
let isMakingOffer = false;
/** Flag indicating if this peer should be polite during offer collisions. */
let isPolite = false;
/** Flag to handle potential race conditions when setting remote descriptions. */
let isSettingRemoteAnswerPending = false; // Currently unused, consider for complex negotiation
/** The local user's media stream (audio/video). */
let localStream = null;
/** Flag to track if media access is in progress */
let isMediaAccessInProgress = false;
/** Flag to track if camera initialization has been attempted */
let hasCameraInitBeenAttempted = false;

<<<<<<< HEAD
/** Configuration for RTCPeerConnection, including ICE servers. */
let peerConnectionConfig = null; // Will be fetched asynchronously

// --- Initialization and Setup ---

/**
 * Parses URL query parameters.
 * @returns {object} An object containing key-value pairs from the query string.
 * @private
 */
function _getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
=======
// اختبار بسيط للـ Local Stream
async function testLocalStream() {
  console.log("🧪 Testing local camera and microphone...");
  try {
    const testStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    console.log(
      "✅ Test Stream successful! Tracks:",
      testStream
        .getTracks()
        .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
    );
    localVideo.srcObject = testStream;
    localVideo.muted = true;
    await localVideo
      .play()
      .catch((e) => console.error("❌ Test Video play failed:", e));
    testStream.getTracks().forEach((track) => track.stop());
    console.log("🧪 Test completed. Local camera and microphone are working.");
  } catch (error) {
    console.error(
      "❌ Test Stream failed:",
      error.name,
      error.message,
      error.stack
    );
    alert(
      `Test Stream failed: ${error.name} - ${error.message}. Please check camera/microphone permissions and ensure they are not blocked.`
    );
  }
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
}

/**
 * Fetches STUN/TURN server configuration.
 * WARNING: Hardcoding TURN server credentials in frontend code is insecure!
 * In a real application, fetch these dynamically from a secure backend service.
 * @returns {Promise<RTCIceServer[]>} A promise that resolves with the ICE server configuration.
 * @private
 */
async function _fetchIceServers() {
  console.log("[Meeting] Fetching ICE servers configuration...");
  // Using hardcoded Xirsys STUN/TURN for demonstration.
  // WARNING: Replace with your own STUN/TURN provider or a dynamic fetching mechanism.
  // Do NOT commit real credentials directly into your codebase.
  return [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, // Public STUN servers
    /*
    // Example of TURN server configuration (replace with actual fetched credentials)
    {
<<<<<<< HEAD
      username: "YOUR_XIRSYS_USERNAME", // Replace with dynamically fetched username
      credential: "YOUR_XIRSYS_CREDENTIAL", // Replace with dynamically fetched credential
=======
      urls: ["stun:fr-turn7.xirsys.com"],
    },
    {
      username:
        "L2a-fvFXKem5bHUHPf_WEX4oi-Ixl0BHHXuz4z_7KSgyjpfxuzhcVM2Tu_DfwOTUAAAAAGgpFR1haG1lZHNhbWVoMDM=",
      credential: "c3c10bb4-3372-11f0-a269-fadfa0afc433",
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
      urls: [
        "turn:fr-turn7.xirsys.com:80?transport=udp",
        "turn:fr-turn7.xirsys.com:3478?transport=udp",
        "turn:fr-turn7.xirsys.com:80?transport=tcp",
        "turn:fr-turn7.xirsys.com:3478?transport=tcp",
        "turns:fr-turn7.xirsys.com:443?transport=tcp",
<<<<<<< HEAD
        "turns:fr-turn7.xirsys.com:5349?transport=tcp"
      ]
    }
    */
  ];
}

/**
 * Initializes the application logic once the DOM is ready.
 * Fetches ICE servers and updates UI elements.
 */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Meeting] DOM content loaded.");
  // Display meeting ID and user name
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
    alert("Error fetching network configuration (ICE servers). Peer connections might fail. Using default STUN.");
    // Provide default STUN server as fallback
    peerConnectionConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  }

  // Add event listeners for UI controls
  _setupUIEventListeners();
});

// --- WebSocket Event Handlers ---

/**
 * Handles the WebSocket connection opening.
 * Initiates camera/microphone access and joins the signaling room.
 */
=======
        "turns:fr-turn7.xirsys.com:5349?transport=tcp",
      ],
    },
  ];
}

>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
ws.onopen = async () => {
  console.log("✅ [Meeting] WebSocket connection established.");
  try {
<<<<<<< HEAD
    // 1. Join the signaling room first, so we're connected even if media fails
    console.log(`[Meeting] Joining room: ${room} as user: ${name}`);
=======
    await startCamera();
    if (!localStream || !localStream.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available.");
    }
    console.log(
      "📹 Local Stream initialized with tracks:",
      localStream
        .getTracks()
        .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
    );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name); // Add self to the UI list

    // 2. Get local media stream (camera/mic)
    if (!hasCameraInitBeenAttempted) {
      hasCameraInitBeenAttempted = true;
      const stream = await startCameraAndMic();
      if (stream && stream.getTracks().length) {
        localStream = stream; // Store the stream globally
        console.log("[Meeting] Local media stream acquired.", localStream.getTracks().map(t => ({ kind: t.kind, id: t.id, enabled: t.enabled })));

        // 3. Display the local stream
        await displayLocalStream();
      } else {
        console.warn("[Meeting] No media tracks obtained, but continuing with chat-only mode");
        // Show a message to the user that they're in chat-only mode
        _showMediaErrorMessage("No camera or microphone available. You can still chat and see others.");
      }
    }
  } catch (error) {
<<<<<<< HEAD
    console.error("❌ [Meeting] Error during WebSocket open sequence:", error);
    // We're still connected to the room, just without media
    _showMediaErrorMessage("Failed to access camera/microphone. You can still chat and see others.");
=======
    console.error("❌ Failed to start camera before joining:", error);
    alert(
      "Failed to start camera/microphone. Please check permissions and try again."
    );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
  }
};

/**
 * Handles WebSocket errors.
 * @param {Event} error - The error event.
 */
ws.onerror = (error) => {
<<<<<<< HEAD
  console.error("❌ [Meeting] WebSocket Error:", error);
  alert("WebSocket connection error. Please check the server status and your network connection. Refresh the page to try again.");
=======
  console.error("❌ WebSocket Error:", error);
  alert(
    "WebSocket connection error. Please check the server and your connection."
  );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
};

/**
 * Handles WebSocket connection closing.
 * Cleans up resources like media streams and peer connections.
 * @param {CloseEvent} event - The close event.
 */
ws.onclose = (event) => {
  console.log(`🔌 [Meeting] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || "(No reason provided)"}, Clean: ${event.wasClean}`);
  if (!event.wasClean) {
<<<<<<< HEAD
    alert("WebSocket connection closed unexpectedly. Please refresh the page to try reconnecting.");
=======
    alert(
      "WebSocket connection closed unexpectedly. Please try refreshing the page."
    );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
  }
  // Clean up all resources
  _cleanupResources();
};

<<<<<<< HEAD
/**
 * Main handler for incoming WebSocket messages (signaling).
 * This function will be enhanced by `meeting-e2ee.js` to handle E2EE messages.
 * @param {MessageEvent} message - The incoming message event.
 */
=======
function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}

async function startCamera() {
  console.log("🎥 Attempting to start camera and microphone...");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    console.log(
      "✅ Attempt 1: Both camera and microphone accessed successfully."
    );
  } catch (error) {
    console.warn("⚠️ Attempt 1 failed:", error.name, error.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      console.log("✅ Attempt 2: Camera only accessed successfully.");
    } catch (error2) {
      console.warn("⚠️ Attempt 2 failed:", error2.name, error2.message);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });
        console.log("✅ Attempt 3: Microphone only accessed successfully.");
      } catch (error3) {
        console.error(
          "❌ All attempts failed:",
          error3.name,
          error3.message,
          error3.stack
        );
        throw new Error(
          "Failed to access camera or microphone after all attempts."
        );
      }
    }
  }

  if (!localStream.getTracks().length) {
    throw new Error("No tracks (video or audio) available.");
  }
  console.log(
    "✅ Final Stream Tracks:",
    localStream
      .getTracks()
      .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
  );
  localVideo.srcObject = localStream;
  localVideo.muted = true;
  await localVideo
    .play()
    .catch((e) => console.error("❌ Video play failed:", e));
}

>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
ws.onmessage = async (message) => {
  let data;
  try {
    data = JSON.parse(message.data);
    // console.log("[Meeting] WebSocket message received:", data); // Verbose: Log all messages
    if (!data || !data.type) {
        console.warn("[Meeting] Received invalid WebSocket message (no type):", data);
        return;
    }

    // --- Signaling Message Handling ---
    switch (data.type) {
      case "new-user":
<<<<<<< HEAD
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
=======
        console.log(`✨ New user joined: ${data.user}`);

        // Don't connect to yourself
        if (data.user === name) return;

        // Add to participant list
        addParticipant(data.user);

        // If not already connected, create a peer and send an offer
        if (!peers[data.user]) {
          await createPeer(data.user);
          await createOffer(data.user);
        }
        break;

      case "offer":
        console.log(`📨 Offer received from ${data.user}`);
        const peer = peers[data.user] || (await createPeer(data.user));
        const offerCollision =
          isMakingOffer || peer.signalingState !== "stable";

        isPolite = name.localeCompare(data.user) > 0;
        if (offerCollision && !isPolite) {
          console.warn(`⚠️ Offer collision from ${data.user}, dropping offer`);
          return;
        }

        try {
          await peer.setRemoteDescription(
            new RTCSessionDescription(data.offer)
          );
          if (peer._bufferedCandidates?.length) {
            for (const candidate of peer._bufferedCandidates) {
              try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
                console.log(`✅ Buffered ICE candidate added for ${data.user}`);
              } catch (e) {
                console.error(`❌ Error adding buffered ICE candidate:`, e);
              }
            }
            peer._bufferedCandidates = [];
          }

          console.log(`✅ Remote offer set for ${data.user}`);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          console.log(`✅ Answer created and set for ${data.user}`);
          ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
        } catch (e) {
          console.error("❌ Failed to handle offer:", e);
        }
        break;

      case "answer":
        console.log(`📬 Answer received from ${data.user}`);
        if (peers[data.user]) {
          const peer = peers[data.user];
          try {
            await peer.setRemoteDescription(
              new RTCSessionDescription(data.answer)
            );
            if (peer._bufferedCandidates?.length) {
              for (const candidate of peer._bufferedCandidates) {
                try {
                  await peer.addIceCandidate(new RTCIceCandidate(candidate));
                  console.log(
                    `✅ Buffered ICE candidate added for ${data.user}`
                  );
                } catch (e) {
                  console.error(`❌ Error adding buffered ICE candidate:`, e);
                }
              }
              peer._bufferedCandidates = [];
            }

            console.log(`✅ Remote description (answer) set for ${data.user}`);
          } catch (e) {
            console.error(
              `❌ Failed to set remote answer for ${data.user}:`,
              e.message
            );
          }
        } else {
          console.warn(`⚠️ No peer connection found for ${data.user}`);
        }
        break;

      case "candidate":
        const peerConn = peers[data.user];
        if (peerConn) {
          if (peerConn.remoteDescription?.type) {
            await peerConn.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            peerConn._bufferedCandidates = peerConn._bufferedCandidates || [];
            peerConn._bufferedCandidates.push(data.candidate);
          }
        }
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
        break;

      case "user-left":
        handleUserLeft(data.user);
        break;

      case "chat":
<<<<<<< HEAD
        handleChatMessage(data.user, data.text);
=======
        console.log(`📩 Chat message received from ${data.user}: ${data.text}`);
        displayMessage({
          user: data.user,
          text: data.text,
          own: data.user === name,
        });
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
        break;

      // Note: E2EE-specific messages (like key exchange) are handled
      // by the enhanced ws.onmessage wrapper in meeting-e2ee.js.

      default:
        console.warn(`[Meeting] Received unknown message type: ${data.type}`);
    }
  } catch (error) {
<<<<<<< HEAD
    console.error("❌ [Meeting] Error parsing or handling WebSocket message:", error, "Raw data:", message.data);
    // Avoid crashing the application due to a single malformed message.
  }
};

// --- Media Stream Handling ---

/**
 * Shows a media error message to the user
 * @param {string} message - The error message to display
 * @private
 */
function _showMediaErrorMessage(message) {
  // Create a notification element if it doesn't exist
  let notification = document.getElementById("media-error-notification");
  if (!notification) {
    notification = document.createElement("div");
    notification.id = "media-error-notification";
    notification.style.position = "fixed";
    notification.style.top = "70px";
    notification.style.left = "50%";
    notification.style.transform = "translateX(-50%)";
    notification.style.backgroundColor = "rgba(220, 53, 69, 0.9)"; // Red background
    notification.style.color = "white";
    notification.style.padding = "10px 20px";
    notification.style.borderRadius = "5px";
    notification.style.zIndex = "1000";
    notification.style.maxWidth = "80%";
    notification.style.textAlign = "center";
    notification.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
    document.body.appendChild(notification);
  }
  
  notification.textContent = message;
  notification.style.display = "block"; // Ensure it's visible
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (notification) {
        notification.style.display = "none";
=======
    console.error(
      "❌ Error handling WebSocket message:",
      error.name,
      error.message,
      error.stack
    );
  }
};

async function createPeer(user) {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
  const iceServers = await fetchIceServers();
  console.log("🧊 ICE Servers used:", iceServers);
  const peer = new RTCPeerConnection({
    iceServers: iceServers,
  });

  peer.oniceconnectionstatechange = () => {
    console.log(`🔌 ICE state for ${user}:`, peer.iceConnectionState);
    if (
      ["failed", "disconnected", "closed"].includes(peer.iceConnectionState)
    ) {
      console.error(
        `❌ ICE connection for ${user} failed/disconnected. State: ${peer.iceConnectionState}`
      );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
    }
  }, 10000);
}

/**
 * Attempts to access the user's camera and microphone.
 * Implements fallbacks if accessing both fails.
 * @returns {Promise<MediaStream>} A promise that resolves with the local media stream.
 * @throws {Error} If access fails after all fallbacks.
 */
async function startCameraAndMic() {
  // Prevent multiple simultaneous attempts
  if (isMediaAccessInProgress) {
    console.log("[Meeting] Media access already in progress, waiting...");
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!isMediaAccessInProgress) {
          clearInterval(checkInterval);
          if (localStream) {
            resolve(localStream);
          } else {
            reject(new Error("Media access failed in previous attempt"));
          }
        }
      }, 500);
      
      // Timeout after 15 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Timed out waiting for previous media access attempt"));
      }, 15000);
    });
  }
  
  isMediaAccessInProgress = true;
  console.log("[Meeting] Attempting to start camera and microphone...");
  
  try {
    // First, check if we already have permission
    const permissionStatus = await _checkMediaPermissions();
    if (!permissionStatus.granted) {
      console.warn(`[Meeting] Media permissions not granted: ${permissionStatus.message}`);
      _showMediaErrorMessage(permissionStatus.message);
      isMediaAccessInProgress = false;
      return null;
    }
    
    let stream = null;
    const constraints = { 
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      }, 
      audio: true 
    };

<<<<<<< HEAD
    try {
      // Attempt 1: Get both video and audio
      console.log("[Meeting] Attempting to access camera and microphone...");
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("getUserMedia timeout")), 15000)
        )
      ]);
      console.log("✅ [Meeting] Both camera and microphone accessed successfully.");
    } catch (error) {
      console.warn(`[Meeting] Video+Audio access failed: ${error.name} - ${error.message}`);
      
      try {
        // Attempt 2: Fallback to video only
        console.log("[Meeting] Attempting fallback: Video only...");
        constraints.audio = false;
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia(constraints),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("getUserMedia timeout")), 10000)
          )
        ]);
        console.log("✅ [Meeting] Camera only accessed successfully.");
        _showMediaErrorMessage("Microphone access failed. You can see and be seen, but not speak or hear others.");
      } catch (error2) {
        console.warn(`[Meeting] Video only access failed: ${error2.name} - ${error2.message}`);
        
        try {
          // Attempt 3: Fallback to audio only
          console.log("[Meeting] Attempting fallback: Audio only...");
          constraints.video = false;
          constraints.audio = true; // Re-enable audio
          stream = await Promise.race([
            navigator.mediaDevices.getUserMedia(constraints),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("getUserMedia timeout")), 10000)
            )
          ]);
          console.log("✅ [Meeting] Microphone only accessed successfully.");
          _showMediaErrorMessage("Camera access failed. You can speak and hear others, but not see or be seen.");
        } catch (error3) {
          console.error(`❌ [Meeting] All media access attempts failed:`, error3);
          _handleGetUserMediaError(error3, "All Media Access Attempts");
          isMediaAccessInProgress = false;
          return null;
        }
      }
=======
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`🧊 Sending ICE candidate to ${user}:`, event.candidate);
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
          room,
          user,
        })
      );
    } else {
      console.log(`🏁 All ICE candidates sent for ${user}`);
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
    }

<<<<<<< HEAD
    // Final check: Ensure the stream has tracks
    if (!stream || !stream.getTracks().length) {
      console.error("[Meeting] Media stream acquired, but it contains no tracks.");
      _showMediaErrorMessage("Failed to access any media devices. You can only chat.");
      isMediaAccessInProgress = false;
      return null;
=======
  peer.onicegatheringstatechange = () => {
    console.log(`🧊 ICE gathering state for ${user}:`, peer.iceGatheringState);
  };

  peer.ontrack = (event) => {
    console.log(`🎞️ Track event for ${user}:`, event);
    console.log(
      `🎞️ Received streams:`,
      event.streams.map((s) => ({ id: s.id, active: s.active }))
    );
    if (event.streams && event.streams[0]) {
      addVideoStream(event.streams[0], user);
    } else {
      console.warn(
        `⚠️ No streams received from ${user}. Check if tracks are sent.`
      );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
    }

    isMediaAccessInProgress = false;
    return stream;
    
  } catch (error) {
    console.error("❌ [Meeting] Unexpected error in startCameraAndMic:", error);
    _handleGetUserMediaError(error, "Unexpected Error");
    isMediaAccessInProgress = false;
    return null;
  }
}

/**
 * Checks if media permissions are available
 * @returns {Promise<{granted: boolean, message: string}>} Permission status
 * @private
 */
async function _checkMediaPermissions() {
  console.log("[Meeting] Checking media permissions...");
  
  // Check if the permissions API is available
  if (navigator.permissions && navigator.permissions.query) {
    try {
      // Check camera permission
      const cameraPermission = await navigator.permissions.query({ name: 'camera' });
      // Check microphone permission
      const micPermission = await navigator.permissions.query({ name: 'microphone' });
      
      if (cameraPermission.state === 'denied' && micPermission.state === 'denied') {
        return {
          granted: false,
          message: "Camera and microphone access denied. Please check your browser settings."
        };
      } else if (cameraPermission.state === 'denied') {
        return {
          granted: false,
          message: "Camera access denied. Please check your browser settings."
        };
      } else if (micPermission.state === 'denied') {
        return {
          granted: false,
          message: "Microphone access denied. Please check your browser settings."
        };
      }
      
      // If permissions are granted or prompt, we can proceed
      return { granted: true, message: "Permissions available" };
      
    } catch (error) {
      console.warn("[Meeting] Could not query media permissions:", error);
      // Fallback: Assume permissions are available and let getUserMedia handle it
      return { granted: true, message: "Could not query permissions, proceeding with getUserMedia" };
    }
  } else {
    console.warn("[Meeting] Permissions API not supported. Proceeding with getUserMedia directly.");
    // Fallback: Assume permissions are available and let getUserMedia handle it
    return { granted: true, message: "Permissions API not supported" };
  }
}

/**
 * Displays the local media stream in the main video element.
 * @returns {Promise<void>}
 * @private
 */
async function displayLocalStream() {
  if (!localStream || !localVideo) {
    console.error("[Meeting] Cannot display local stream: Stream or video element missing.");
    return;
  }
  
  console.log("[Meeting] Displaying local stream...");
  localVideo.srcObject = localStream;
  localVideo.muted = true; // Mute local video to prevent echo
  
  try {
    // Add a visible UI indicator while waiting for video
    document.body.classList.add('loading-video');
    
    // Play with timeout and visual feedback
    await Promise.race([
      localVideo.play(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Video play timeout")), 8000)
      )
    ]);
    
    console.log("✅ [Meeting] Local video playback started successfully.");
  } catch (error) {
    console.error(`❌ [Meeting] Local video play failed: ${error.message}`);
    
    // Try one more time with a delay
    setTimeout(async () => {
      try {
        await localVideo.play();
        console.log("✅ [Meeting] Local video playback started on retry.");
      } catch (retryError) {
        console.error(`❌ [Meeting] Local video play retry failed: ${retryError.message}`);
        _showMediaErrorMessage(`Could not display camera: ${error.name}. Please refresh and try again.`);
      } finally {
        document.body.classList.remove('loading-video');
      }
    }, 1000);
  } finally {
    // Remove loading indicator in normal case
    document.body.classList.remove('loading-video');
  }
}

/**
 * Provides user-friendly error messages for getUserMedia failures.
 * @param {Error} error - The error object from getUserMedia.
 * @param {string} [context="getUserMedia"] - Context where the error occurred.
 * @private
 */
function _handleGetUserMediaError(error, context = "getUserMedia") {
  console.error(`❌ [Meeting] ${context} Error:`, error.name, error.message, error.stack);
  let userMessage = `Failed to access camera/microphone: ${error.name}.\n\n`;

  switch (error.name) {
    case "NotAllowedError": // User denied permission
    case "SecurityError": // Security policy issue
      userMessage = "Camera/microphone access denied. Please check your browser permissions and refresh the page.";
      break;
    case "NotFoundError": // No device found
      userMessage = "No camera or microphone found. Please connect a device and refresh.";
      break;
    case "NotReadableError": // Hardware error or device in use
      userMessage = "Camera or microphone is in use by another application or encountered a hardware error. Please check other apps and try refreshing.";
      break;
    case "OverconstrainedError": // Constraints not met
      userMessage = "Your camera/microphone doesn't support the requested settings.";
      break;
    case "AbortError": // Request aborted
      userMessage = "Media access request was aborted. Please try again.";
      break;
    case "TypeError": // Constraints invalid
      userMessage = "Invalid camera/microphone configuration requested.";
      break;
    default: // Unknown error
      if (error.message && error.message.includes("timeout")) {
        userMessage = "Media access timed out. Please check your devices and refresh.";
      } else {
        userMessage = `An unknown error occurred while accessing your camera/microphone (${error.name}). Please refresh and try again.`;
      }
  }
  
  _showMediaErrorMessage(userMessage);
}

/**
 * Cleans up all resources (media streams, peer connections).
 * Called when leaving the meeting or on WebSocket close.
 * @private
 */
function _cleanupResources() {
  console.log("[Meeting] Cleaning up resources...");
  // Stop all local media tracks
  if (localStream) {
<<<<<<< HEAD
    localStream.getTracks().forEach(track => {
      if (track.readyState === 'live') { // Check if track is still active
        track.stop();
        console.log(`[Meeting] Stopped local ${track.kind} track (ID: ${track.id}).`);
      }
    });
    localStream = null;
  }
  
  // Close all peer connections
  Object.keys(peers).forEach(user => {
    if (peers[user]) {
      try {
        peers[user].close();
        console.log(`[Meeting] Closed peer connection with ${user}.`);
      } catch (e) {
        console.warn(`[Meeting] Error closing peer connection with ${user}:`, e);
      }
    }
  });
  
  // Clear the peers object
  Object.keys(peers).forEach(user => delete peers[user]);
  console.log("[Meeting] Cleared peers object.");

  // Remove all remote video elements
  const remoteVideos = videoGrid.querySelectorAll('.video-container:not(#main-video-container)');
  remoteVideos.forEach(videoContainer => videoContainer.remove());
  console.log("[Meeting] Removed remote video elements.");

  // Clear participants list (except self)
  const participantElements = participantsList.querySelectorAll('.participant');
  participantElements.forEach(el => {
      if (!el.textContent.includes('(You)')) {
          el.remove();
      }
  });
  updateParticipantCount(); // Update count after clearing
  console.log("[Meeting] Cleared participants list.");
}

// --- WebRTC Peer Connection Handling ---

/**
 * Creates a new RTCPeerConnection for a given remote user.
 * @param {string} remoteUser - The username of the remote peer.
 * @returns {Promise<RTCPeerConnection | null>} A promise resolving with the created peer, or null on failure.
 */
async function createPeer(remoteUser) {
  if (peers[remoteUser]) {
    console.warn(`[Meeting] Peer connection already exists for ${remoteUser}. Reusing.`);
    // Consider checking connection state and potentially recreating if closed/failed
    if (peers[remoteUser].connectionState === 'closed' || peers[remoteUser].connectionState === 'failed') {
        console.warn(`[Meeting] Existing peer connection with ${remoteUser} is ${peers[remoteUser].connectionState}. Recreating.`);
        delete peers[remoteUser]; // Remove old one before creating new
    } else {
        return peers[remoteUser];
    }
  }
  if (!peerConnectionConfig) {
      console.error("❌ [Meeting] Cannot create peer: ICE server configuration not loaded.");
      alert("Network configuration missing. Cannot connect to peers.");
      return null;
  }

  console.log(`[Meeting] Creating new peer connection for: ${remoteUser}`);
  const peer = new RTCPeerConnection(peerConnectionConfig);
  peers[remoteUser] = peer;

  // --- Peer Connection Event Handlers ---

  /** Handles ICE candidate generation. */
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      // console.log(`[Meeting] Sending ICE candidate to ${remoteUser}:`, event.candidate); // Verbose
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user: name, targetUser: remoteUser }));
    } else {
      // console.log(`[Meeting] All ICE candidates sent for ${remoteUser}.`); // Verbose
    }
  };

  /** Handles ICE connection state changes. */
  peer.oniceconnectionstatechange = () => {
    console.log(`[Meeting] ICE connection state with ${remoteUser}: ${peer.iceConnectionState}`);
    switch (peer.iceConnectionState) {
        case "connected":
            console.log(`✅ [Meeting] ICE connection established with ${remoteUser}.`);
            break;
        case "disconnected":
            console.warn(`🔌 [Meeting] ICE connection disconnected with ${remoteUser}. Attempting restart...`);
            // Attempt ICE restart (simple version)
            if (peer.restartIce) {
                peer.restartIce();
            } else {
                // Fallback: Recreate offer if restartIce is not supported (older browsers)
                // This is less efficient and might cause glare issues if not handled carefully
                console.warn("[Meeting] peer.restartIce() not supported, consider offer recreation (not implemented here).");
            }
            break;
        case "failed":
            console.error(`❌ [Meeting] ICE connection failed with ${remoteUser}. Consider notifying user or attempting full reconnect.`);
            // More robust recovery could involve signaling for a full reconnect
            _showMediaErrorMessage(`Connection failed with ${remoteUser}. Attempting to recover...`);
            if (peer.restartIce) {
                peer.restartIce();
            } 
            break;
        case "closed":
            console.log(`[Meeting] ICE connection closed with ${remoteUser}.`);
            // Clean up resources associated with this peer if necessary
            // handleUserLeft(remoteUser); // Might be redundant if user-left signal is received
            break;
    }
  };

  /** Handles remote tracks being added. */
  peer.ontrack = (event) => {
    console.log(`[Meeting] Received ${event.track.kind} track (ID: ${event.track.id}) from ${remoteUser}. Stream IDs: ${event.streams.map(s => s.id).join(', ')}`);
    
    // Create or get the video element for this user
    let videoElement = document.getElementById(`video-${remoteUser}`);
    let videoContainer = document.getElementById(`video-container-${remoteUser}`);

    if (!videoContainer) {
      // Create new video container and element
      videoContainer = document.createElement("div");
      videoContainer.className = "video-container";
      videoContainer.id = `video-container-${remoteUser}`;
      
      videoElement = document.createElement("video");
      videoElement.id = `video-${remoteUser}`;
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      
      const nameLabel = document.createElement("p");
      nameLabel.textContent = remoteUser;
      
      videoContainer.appendChild(videoElement);
      videoContainer.appendChild(nameLabel);
      videoGrid.appendChild(videoContainer);
      
      console.log(`[Meeting] Created new video element container for ${remoteUser}.`);
    }
    
    // Assign the stream to the video element
    // Use the first stream associated with the track
    if (event.streams && event.streams[0]) {
        if (videoElement.srcObject !== event.streams[0]) {
            console.log(`[Meeting] Assigning stream ${event.streams[0].id} to video element for ${remoteUser}.`);
            videoElement.srcObject = event.streams[0];
            // Play the video (with error handling)
            videoElement.play().catch(error => {
              console.error(`❌ [Meeting] Error playing remote video for ${remoteUser}:`, error);
              _showMediaErrorMessage(`Could not play video from ${remoteUser}.`);
            });
        }
    } else {
        // Fallback if no streams associated (less common with Unified Plan)
        console.warn(`[Meeting] Track from ${remoteUser} has no associated streams. Attempting to add track directly.`);
        if (!videoElement.srcObject) {
            videoElement.srcObject = new MediaStream();
        }
        videoElement.srcObject.addTrack(event.track);
        videoElement.play().catch(error => {
            console.error(`❌ [Meeting] Error playing remote video (direct track) for ${remoteUser}:`, error);
        });
    }
  };

  /** Handles negotiation needed events. */
  peer.onnegotiationneeded = async () => {
    try {
      // Implement debounce or check signaling state to avoid rapid firing
      if (isMakingOffer || peer.signalingState !== "stable") {
        console.warn(`[Meeting] Negotiation needed for ${remoteUser}, but already in progress or state is not stable (${peer.signalingState}). Skipping.`);
        return;
      }
      
      isMakingOffer = true;
      console.log(`[Meeting] Negotiation needed for ${remoteUser}. Creating offer...`);
      
      // Create and set local description
      const offer = await peer.createOffer();
      // Check signaling state again before setting local description
      if (peer.signalingState !== "stable") {
          console.warn(`[Meeting] Signaling state changed before setting local description for ${remoteUser}. Aborting offer.`);
          isMakingOffer = false;
          return;
      }
      await peer.setLocalDescription(offer);
      
      // Send the offer to the remote peer
      ws.send(JSON.stringify({
        type: "offer",
        offer: peer.localDescription,
        room,
        user: name,
        targetUser: remoteUser
      }));
      
      console.log(`[Meeting] Offer sent to ${remoteUser}.`);
    } catch (error) {
      console.error(`❌ [Meeting] Error creating/sending offer to ${remoteUser}:`, error);
    } finally {
      isMakingOffer = false;
    }
  };

  // Add local tracks to the peer connection (if available)
  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
          peer.addTrack(track, localStream);
          console.log(`[Meeting] Added local ${track.kind} track (ID: ${track.id}) to peer connection with ${remoteUser}.`);
      } catch (e) {
          console.error(`❌ [Meeting] Error adding local ${track.kind} track to ${remoteUser}:`, e);
=======
    localStream.getTracks().forEach((track) => {
      console.log(`➕ Adding local track for ${user}:`, {
        kind: track.kind,
        enabled: track.enabled,
        id: track.id,
      });
      if (track.enabled) {
        const sender = peer.addTrack(track, localStream);
        console.log(`✅ Added ${track.kind} track with sender:`, sender);
      } else {
        console.warn(
          `⚠️ Track ${track.kind} is disabled for ${user}. Enabling it...`
        );
        track.enabled = true;
        const sender = peer.addTrack(track, localStream);
        console.log(
          `✅ Forced enabled and added ${track.kind} track with sender:`,
          sender
        );
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
      }
    });
  } else {
    console.warn(`[Meeting] No local stream available to share with ${remoteUser}.`);
  }

<<<<<<< HEAD
  // Apply E2EE if enabled (this will be a no-op if E2EE is not enabled)
  if (typeof e2eeManager !== "undefined" && e2eeManager && e2eeManager.isE2EEEnabled) {
    console.log(`[Meeting] Applying E2EE setup to new peer connection with ${remoteUser}.`);
    e2eeManager.setupPeerConnection(peer);
  }

=======
  peers[user] = peer;
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
  return peer;
}

// --- Signaling Message Handlers ---

/**
 * Handles a new user joining the room.
 * @param {string} user - The username of the new user.
 */
async function handleNewUser(user) {
  console.log(`[Meeting] New user joined: ${user}`);
  
  // Add the user to the participants list
  addParticipant(user);
  
  // Create a peer connection for the new user
  try {
<<<<<<< HEAD
    // Set polite flag (the existing user is impolite, the joiner is polite)
    isPolite = false; 
    
    const peer = await createPeer(user);
    if (!peer) {
      console.error(`[Meeting] Failed to create peer connection for ${user}.`);
      return;
    }
    
    // The existing user (impolite) initiates the connection
    // The 'negotiationneeded' event should trigger offer creation in createPeer
    console.log(`[Meeting] Peer connection created for new user ${user}. Waiting for negotiation.`);

  } catch (error) {
    console.error(`❌ [Meeting] Error handling new user ${user}:`, error);
=======
    peers[user]._flags = peers[user]._flags || {};
    peers[user]._flags.makingOffer = true;
    const peer = peers[user];
    console.log(
      `🔍 Signaling state before creating offer for ${user}:`,
      peer.signalingState
    );
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(
      `✅ Offer created and set for ${user}. New signaling state:`,
      peer.signalingState
    );
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
  } catch (e) {
    console.error("❌ Error creating offer:", e.message, e.stack);
  } finally {
    peers[user]._flags.makingOffer = false;
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
  }
}

/**
 * Handles an offer from a remote user.
 * @param {string} user - The username of the remote user.
 * @param {RTCSessionDescriptionInit} offer - The received offer.
 */
async function handleOffer(user, offer) {
  console.log(`[Meeting] Received offer from ${user}.`);
  
  try {
<<<<<<< HEAD
    // Get or create peer connection
    let peer = peers[user];
    if (!peer) {
      // If peer doesn't exist, this user joined before us or there was an issue.
      // We should be polite in this case.
      isPolite = true;
      peer = await createPeer(user);
      if (!peer) {
        throw new Error(`Failed to create peer connection for ${user} upon receiving offer.`);
      }
    }
    
    // Handle potential glare (both peers creating offers simultaneously)
    const offerCollision = isMakingOffer || peer.signalingState !== "stable";
    
    // If collision and we're not polite, ignore this offer
    if (offerCollision && !isPolite) {
      console.log(`[Meeting] Ignoring offer from ${user} due to collision (impolite peer).`);
      return;
    }
    
    console.log(`[Meeting] Processing offer from ${user}. Polite: ${isPolite}, Collision: ${offerCollision}`);
    
    // If we need to roll back, do it
    if (offerCollision && isPolite) {
      console.log(`[Meeting] Handling offer collision with ${user} (polite peer). Rolling back local offer.`);
      await Promise.all([
        peer.setLocalDescription({ type: "rollback" }),
        peer.setRemoteDescription(offer)
      ]);
    } else {
      // Normal case or impolite peer collision (accept remote offer)
      await peer.setRemoteDescription(offer);
    }
    
    // Create and send answer
    console.log(`[Meeting] Creating answer for ${user}...`);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    
    ws.send(JSON.stringify({
      type: "answer",
      answer: peer.localDescription,
      room,
      user: name,
      targetUser: user
    }));
    
    console.log(`[Meeting] Answer sent to ${user}.`);
  } catch (error) {
    console.error(`❌ [Meeting] Error handling offer from ${user}:`, error);
  }
}

/**
 * Handles an answer from a remote user.
 * @param {string} user - The username of the remote user.
 * @param {RTCSessionDescriptionInit} answer - The received answer.
 */
async function handleAnswer(user, answer) {
  console.log(`[Meeting] Received answer from ${user}.`);
  
  try {
    const peer = peers[user];
    if (!peer) {
      console.error(`[Meeting] No peer connection exists for ${user} to handle answer.`);
      return;
    }
    
    // Set the remote description
    await peer.setRemoteDescription(answer);
    console.log(`[Meeting] Set remote description (answer) for ${user}. Connection state: ${peer.connectionState}`);
  } catch (error) {
    console.error(`❌ [Meeting] Error handling answer from ${user}:`, error);
  }
}

/**
 * Handles an ICE candidate from a remote user.
 * @param {string} user - The username of the remote user.
 * @param {RTCIceCandidateInit} candidate - The received ICE candidate.
 */
async function handleCandidate(user, candidate) {
  // console.log(`[Meeting] Received ICE candidate from ${user}.`); // Verbose
  
  try {
    const peer = peers[user];
    if (!peer) {
      console.error(`[Meeting] No peer connection exists for ${user} to add ICE candidate.`);
      return;
    }
    
    // Add the ICE candidate only if remote description is set
    if (peer.remoteDescription) {
        await peer.addIceCandidate(candidate);
        // console.log(`[Meeting] Added ICE candidate for ${user}.`); // Verbose
    } else {
        console.warn(`[Meeting] Received ICE candidate from ${user} before remote description was set. Queueing candidate (not implemented).`);
        // TODO: Implement candidate queueing if necessary
    }
  } catch (error) {
    // Ignore benign errors like candidate addition after connection close
    if (!error.message.includes("Cannot add ICE candidate when RTCConfiguration.iceTransportPolicy is relay")) {
        console.error(`❌ [Meeting] Error handling ICE candidate from ${user}:`, error);
    }
  }
}

/**
 * Handles a user leaving the room.
 * @param {string} user - The username of the user who left.
 */
function handleUserLeft(user) {
  console.log(`[Meeting] User left: ${user}`);
  
  // Remove the user from the participants list
  removeParticipant(user);
  
  // Close and remove the peer connection
=======
    const peer = peers[user];
    console.log(
      `🔍 Signaling state before setting offer for ${user}:`,
      peer.signalingState
    );
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    console.log(
      `✅ Remote offer set for ${user}. New signaling state:`,
      peer.signalingState
    );
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    console.log(
      `✅ Answer created and set for ${user}. New signaling state:`,
      peer.signalingState
    );
    ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
  } catch (e) {
    console.error("❌ Error creating answer:", e.message, e.stack);
  }
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  console.log(
    `➕ Adding video stream for ${user} with stream ID: ${stream.id}`
  );
  const container = document.createElement("div");
  container.classList.add("video-container");
  container.setAttribute("data-user-container", user);

  const videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.setAttribute("data-user", user);

  const nameTag = document.createElement("p");
  nameTag.textContent = user;

  container.appendChild(videoEl);
  container.appendChild(nameTag);
  videoGrid.appendChild(container);
}

function removeVideoStream(user) {
  console.log(`➖ Removing video stream for ${user}`);
  const container = document.querySelector(
    `div[data-user-container="${user}"]`
  );
  if (container) container.remove();
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
  if (peers[user]) {
    try {
        peers[user].close();
        console.log(`[Meeting] Closed peer connection with ${user}.`);
    } catch (e) {
        console.warn(`[Meeting] Error closing peer connection with ${user} on leave:`, e);
    }
    delete peers[user];
  }
  
  // Remove the user's video element
  const videoContainer = document.getElementById(`video-container-${user}`);
  if (videoContainer) {
    videoContainer.remove();
    console.log(`[Meeting] Removed video element for ${user}.`);
  }
}

/**
 * Handles a chat message from a remote user.
 * @param {string} user - The username of the sender.
 * @param {string} text - The message text.
 */
function handleChatMessage(user, text) {
  console.log(`[Meeting] Received chat message from ${user}: ${text}`);
  
  // Add the message to the chat display
  const messageElement = document.createElement("div");
  messageElement.className = "chat-message";
  // Basic sanitization (replace < and > to prevent HTML injection)
  const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  messageElement.innerHTML = `<strong>${user}:</strong> ${sanitizedText}`;
  chatMessages.appendChild(messageElement);
  
  // Scroll to the bottom of the chat
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // If the chat is not visible, indicate a new message
  const chatContainer = document.getElementById("chat-container");
  if (chatContainer && !chatContainer.classList.contains("visible")) {
    // Add notification indicator (e.g., badge or highlight)
    const chatButton = document.querySelector("button[onclick='toggleChat()']");
    if (chatButton) {
      chatButton.classList.add("new-message");
    }
  }
}

// --- UI Interaction Functions ---

/**
 * Adds a participant to the participants list.
 * @param {string} user - The username to add.
 */
function addParticipant(user) {
  // Check if the participant is already in the list
  if (document.getElementById(`participant-${user}`)) {
    return;
  }
  
  // Create a new participant element
  const participantElement = document.createElement("div");
  participantElement.id = `participant-${user}`;
  participantElement.className = "participant";
  
  // Add user icon and name
  participantElement.innerHTML = `
    <i class="fas fa-user"></i>
    <span>${user}</span>
    ${user === name ? ' <span class="badge">(You)</span>' : ''}
  `;
  
  // Add to the participants list
  participantsList.appendChild(participantElement);
  
  // Update participant count
  updateParticipantCount();
}

/**
 * Removes a participant from the participants list.
 * @param {string} user - The username to remove.
 */
function removeParticipant(user) {
  const participantElement = document.getElementById(`participant-${user}`);
  if (participantElement) {
    participantElement.remove();
  }
  
  // Update participant count
  updateParticipantCount();
}

/**
 * Updates the participant count display.
 */
function updateParticipantCount() {
  const count = participantsList.children.length;
  const countElement = document.querySelector(".participants-header h5");
  if (countElement) {
    countElement.textContent = `Participants (${count})`;
  }
}

<<<<<<< HEAD
/**
 * Toggles the visibility of the chat container.
 */
function toggleChat() {
  const chatContainer = document.getElementById("chat-container");
  if (chatContainer) {
    chatContainer.classList.toggle("visible");
    // If opening the chat, remove the new message indicator
    if (chatContainer.classList.contains("visible")) {
      const chatButton = document.querySelector("button[onclick='toggleChat()']");
      if (chatButton) {
        chatButton.classList.remove("new-message");
=======
function toggleVideo() {
  if (!localStream) return console.error("No local stream");
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length) {
    isVideoOff = !isVideoOff;
    videoTracks[0].enabled = !isVideoOff;
    console.log(`📹 Video ${isVideoOff ? "off" : "on"}`);
    document
      .getElementById("video-btn")
      ?.classList.toggle("active", isVideoOff);
  }
}

let screenStream, screenVideoElement;

async function shareScreen() {
  console.log("🖥️ Attempting to share screen...");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    screenVideoElement = document.createElement("video");
    screenVideoElement.srcObject = screenStream;
    screenVideoElement.autoplay = true;
    screenVideoElement.id = "screen-share";
    videoGrid.appendChild(screenVideoElement);

    // ✅ Make sure each peer is a valid RTCPeerConnection
    Object.entries(peers).forEach(([user, peer]) => {
      if (peer instanceof RTCPeerConnection) {
        const sender = peer.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          sender.replaceTrack(screenStream.getVideoTracks()[0]);
          console.log(`🔁 Replaced video track for ${user}`);
        } else {
          console.warn(`⚠️ No video sender found for ${user}`);
        }
      } else {
        console.warn(`❌ Peer object for ${user} is invalid:`, peer);
      }
    });

    screenStream.getVideoTracks()[0].onended = () => {
      console.log("🛑 Screen share ended.");
      stopScreenShare();
    };
  } catch (error) {
    console.error("❌ Error sharing screen:", error);
    alert(`Error sharing screen: ${error.name} - ${error.message}`);
  }
}

function stopScreenShare() {
  console.log("🛑 Stopping screen share...");

  // Stop all tracks from screen stream
  screenStream?.getTracks().forEach((t) => t.stop());

  // Remove screen share video element and its container if present
  if (screenVideoElement) {
    const container = screenVideoElement.closest(".video-container");
    if (container) {
      container.remove(); // ✅ removes the black box
    } else {
      screenVideoElement.remove(); // fallback in case no container
    }
  }

  screenStream = null;
  screenVideoElement = null;

  // Revert to local camera
  const cameraTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach((peer) => {
    if (peer instanceof RTCPeerConnection) {
      const sender = peer.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(cameraTrack);
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
      }
    }
  }
}

<<<<<<< HEAD
/**
 * Toggles the visibility of the participants container.
 */
function toggleParticipants() {
  const participantsContainer = document.getElementById("participants-container");
  if (participantsContainer) {
    participantsContainer.classList.toggle("visible");
  }
}

/**
 * Sends a chat message to all participants.
 */
=======
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
function sendMessage() {
  const text = chatInputField.value.trim();
  if (!text) return;
  
  console.log(`[Meeting] Sending chat message: ${text}`);
  
  // Send the message via WebSocket
  ws.send(JSON.stringify({
    type: "chat",
    text,
    room,
    user: name
  }));
  
  // Add the message to the local chat display
  handleChatMessage(name, text); // Display own message immediately
  
  // Clear the input field
  chatInputField.value = "";
}

<<<<<<< HEAD
/**
 * Toggles the mute state of the local audio track.
 */
function toggleMute() {
  if (!localStream) {
      _showMediaErrorMessage("Cannot toggle mute: No microphone available.");
      return;
  }
  
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) {
    console.warn("[Meeting] No audio track found to toggle mute.");
    _showMediaErrorMessage("Cannot toggle mute: No microphone track found.");
    return;
  }
  
  isMuted = !isMuted;
  audioTrack.enabled = !isMuted;
  
  // Update the UI
  const muteButton = document.getElementById("mute-btn");
  if (muteButton) {
    const icon = muteButton.querySelector("i");
    if (icon) {
      icon.className = isMuted ? "fas fa-microphone-slash" : "fas fa-microphone";
    }
    muteButton.classList.toggle("active", !isMuted);
    muteButton.title = isMuted ? "Unmute" : "Mute";
  }
  
  console.log(`[Meeting] Microphone ${isMuted ? "muted" : "unmuted"}.`);
}

/**
 * Toggles the enabled state of the local video track.
 */
function toggleVideo() {
  if (!localStream) {
      _showMediaErrorMessage("Cannot toggle video: No camera available.");
      return;
  }
  
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    console.warn("[Meeting] No video track found to toggle video.");
    _showMediaErrorMessage("Cannot toggle video: No camera track found.");
    return;
  }
  
  isVideoOff = !isVideoOff;
  videoTrack.enabled = !isVideoOff;
  
  // Update the UI
  const videoButton = document.getElementById("video-btn");
  if (videoButton) {
    const icon = videoButton.querySelector("i");
    if (icon) {
      icon.className = isVideoOff ? "fas fa-video-slash" : "fas fa-video";
    }
    videoButton.classList.toggle("active", !isVideoOff);
    videoButton.title = isVideoOff ? "Start Video" : "Stop Video";
  }
  
  console.log(`[Meeting] Camera ${isVideoOff ? "turned off" : "turned on"}.`);
}

/**
 * Shares the user's screen.
 */
async function shareScreen() {
  if (!localStream) {
      _showMediaErrorMessage("Cannot share screen: Camera/Mic stream not available.");
      return;
  }

  try {
    // Request screen sharing
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false // Audio sharing often requires more complex handling
    });
    
    console.log("[Meeting] Screen sharing started.");
    
    // Get the video track from the screen stream
    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) {
        console.error("❌ [Meeting] Failed to get screen track from display media stream.");
        _showMediaErrorMessage("Could not start screen sharing.");
        return;
    }
    
    // Replace the camera track with the screen track in all peer connections
    let replaced = false;
    Object.values(peers).forEach(peer => {
      const senders = peer.getSenders();
      const videoSender = senders.find(sender => sender.track && sender.track.kind === "video");
      if (videoSender) {
        videoSender.replaceTrack(screenTrack)
          .then(() => {
              console.log(`[Meeting] Replaced video track with screen track for peer.`);
              replaced = true;
          })
          .catch(e => console.error(`❌ [Meeting] Error replacing track for screen share:`, e));
      }
    });
    
    // Update the local video display
    localVideo.srcObject = screenStream;
    
    // When screen sharing stops (user clicks "Stop sharing" in browser UI)
    screenTrack.onended = async () => {
      console.log("[Meeting] Screen sharing stopped by user.");
      
      // Revert to camera
      if (localStream) {
        const cameraTrack = localStream.getVideoTracks()[0];
        if (cameraTrack && cameraTrack.readyState === 'live') {
          // Replace the screen track with the camera track in all peer connections
          Object.values(peers).forEach(peer => {
            const senders = peer.getSenders();
            const videoSender = senders.find(sender => sender.track && sender.track.kind === "video");
            if (videoSender) {
              videoSender.replaceTrack(cameraTrack)
                .then(() => console.log(`[Meeting] Reverted to camera track for peer.`))
                .catch(e => console.error(`❌ [Meeting] Error reverting to camera track:`, e));
            }
          });
          
          // Update the local video display
          localVideo.srcObject = localStream;
        } else {
            console.warn("[Meeting] Cannot revert to camera: Original camera track not found or not live.");
            // Optionally stop video if camera cannot be restored
            toggleVideo(); // Turn video off
        }
      } else {
          console.warn("[Meeting] Cannot revert to camera: Original local stream not available.");
      }
    };
  } catch (error) {
    console.error("❌ [Meeting] Error sharing screen:", error);
    if (error.name !== "NotAllowedError") { // Don't alert if user just cancelled
        alert(`Screen sharing failed: ${error.name}. ${error.message}`);
    }
  }
}

/**
 * Leaves the meeting and redirects to the dashboard.
 */
function leaveMeeting() {
  console.log("[Meeting] Leaving meeting...");
  
  // Clean up resources
  _cleanupResources();
  
  // Close the WebSocket connection gracefully
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "User left meeting"); // Use code 1000 for normal closure
  }
  
  // Redirect to the dashboard (or index page)
  // Use index.html as dashboard.html doesn't exist in the provided zip
  window.location.href = "index.html"; 
}

/**
 * Sets up event listeners for UI elements.
 * @private
 */
function _setupUIEventListeners() {
  // Chat input field: Send message on Enter key
  chatInputField.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent default form submission/newline
      sendMessage();
    }
  });
  
  // Add CSS for loading indicator and new message badge
  const style = document.createElement("style");
  style.textContent = `
    .loading-video:after {
      content: "Loading video...";
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 9999;
    }
    
    .new-message {
      position: relative;
    }
    
    .new-message:after {
      content: "";
      position: absolute;
      top: 2px; /* Adjust position */
      right: 2px; /* Adjust position */
      width: 8px;
      height: 8px;
      background-color: #ff4d4d;
      border-radius: 50%;
      box-shadow: 0 0 3px #ff4d4d;
    }
  `;
  document.head.appendChild(style);
}

// --- Expose functions to the global scope (needed for inline HTML event handlers) ---
window.toggleChat = toggleChat;
window.toggleParticipants = toggleParticipants;
window.sendMessage = sendMessage;
window.toggleMute = toggleMute;
window.toggleVideo = toggleVideo;
window.shareScreen = shareScreen;
window.leaveMeeting = leaveMeeting;
// Note: E2EE related functions (toggleE2EESettings, enableE2EE, disableE2EE) are exposed in meeting-e2ee.js

=======
function displayMessage({ user, text, own }) {
  console.log(`📩 Displaying message from ${user}: ${text}`);
  const el = document.createElement("p");
  el.innerHTML = `<strong>${user}:</strong> ${text}`;
  if (own) el.classList.add("own-message");
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function toggleChat() {
  document.getElementById("chat-container").classList.toggle("visible");
}

function toggleParticipants() {
  document.getElementById("participants-container").classList.toggle("visible");
}

function leaveMeeting() {
  if (!confirm("Are you sure you want to leave the meeting?")) return;
  console.log("🚪 Leaving meeting...");
  localStream?.getTracks().forEach((t) => t.stop());
  Object.values(peers).forEach((p) => p.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}
>>>>>>> 1dedc54829265a2481b9f1a8f6ca74b5da857e01
