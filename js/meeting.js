// js/meeting.js

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
  ? "ws://localhost:3001" // Local development
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production-65d5.up.railway.app`; // Production

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
}

/**
 * Fetches STUN/TURN server configuration.
 * In a real application, this should fetch credentials dynamically from a secure backend.
 * @returns {Promise<RTCIceServer[]>} A promise that resolves with the ICE server configuration.
 * @private
 */
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
    alert("Error fetching network configuration (ICE servers). Peer connections might fail.");
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
ws.onopen = async () => {
  console.log("✅ [Meeting] WebSocket connection established.");
  try {
    // 1. Join the signaling room first, so we're connected even if media fails
    console.log(`[Meeting] Joining room: ${room} as user: ${name}`);
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
    console.error("❌ [Meeting] Error during WebSocket open sequence:", error);
    // We're still connected to the room, just without media
    _showMediaErrorMessage("Failed to access camera/microphone. You can still chat and see others.");
  }
};

/**
 * Handles WebSocket errors.
 * @param {Event} error - The error event.
 */
ws.onerror = (error) => {
  console.error("❌ [Meeting] WebSocket Error:", error);
  alert("WebSocket connection error. Please check the server status and your network connection.");
};

/**
 * Handles WebSocket connection closing.
 * Cleans up resources like media streams and peer connections.
 * @param {CloseEvent} event - The close event.
 */
ws.onclose = (event) => {
  console.log(`🔌 [Meeting] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || "."}, Clean: ${event.wasClean}`);
  if (!event.wasClean) {
    alert("WebSocket connection closed unexpectedly. Please try refreshing the page.");
  }
  // Clean up all resources
  _cleanupResources();
};

/**
 * Main handler for incoming WebSocket messages (signaling).
 * This function will be enhanced by `meeting-e2ee.js` to handle E2EE messages.
 * @param {MessageEvent} message - The incoming message event.
 */
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

      // Note: E2EE-specific messages (like key exchange) are handled
      // by the enhanced ws.onmessage wrapper in meeting-e2ee.js.

      default:
        console.warn(`[Meeting] Received unknown message type: ${data.type}`);
    }
  } catch (error) {
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
    notification.style.backgroundColor = "rgba(220, 53, 69, 0.9)";
    notification.style.color = "white";
    notification.style.padding = "10px 20px";
    notification.style.borderRadius = "5px";
    notification.style.zIndex = "1000";
    notification.style.maxWidth = "80%";
    notification.style.textAlign = "center";
    document.body.appendChild(notification);
  }
  
  notification.textContent = message;
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    notification.style.display = "none";
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
    }

    // Final check: Ensure the stream has tracks
    if (!stream || !stream.getTracks().length) {
      console.error("[Meeting] Media stream acquired, but it contains no tracks.");
      _showMediaErrorMessage("Failed to access any media devices. You can only chat.");
      isMediaAccessInProgress = false;
      return null;
    }
 if (stream) {
  if (stream.getVideoTracks().length > 0) {
    stream.getVideoTracks().forEach(track => {
      track.enabled = true;
      console.log(`[Fix] Ensured video track is enabled: ${track.label}`);
    });
  }
  if (stream.getAudioTracks().length > 0) {
    stream.getAudioTracks().forEach(track => {
      track.enabled = true;
      console.log(`[Fix] Ensured audio track is enabled: ${track.label}`);
    });
  }
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
      console.warn("[Meeting] Error checking permissions:", error);
      // Fall back to device enumeration
    }
  }
  
  // Fallback: Check if devices are available
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some(device => device.kind === 'videoinput');
    const hasMic = devices.some(device => device.kind === 'audioinput');
    
    if (!hasCamera && !hasMic) {
      return {
        granted: false,
        message: "No camera or microphone detected on your device."
      };
    } else if (!hasCamera) {
      return {
        granted: false,
        message: "No camera detected on your device."
      };
    } else if (!hasMic) {
      return {
        granted: false,
        message: "No microphone detected on your device."
      };
    }
    
    return { granted: true, message: "Devices available" };
    
  } catch (error) {
    console.error("[Meeting] Error enumerating devices:", error);
    // If we can't check, assume permissions might be available
    return { granted: true, message: "Unable to check permissions" };
  }
}

/**
 * Displays the local media stream in the designated video element.
 * @returns {Promise<void>} Resolves when playback starts or fails gracefully.
 */
async function displayLocalStream() {
  if (!localStream) {
    console.error("[Meeting] Cannot display local stream: stream is null.");
    return;
  }
  if (!localVideo) {
    console.error("[Meeting] Cannot display local stream: localVideo element not found.");
    return;
  }

  console.log("[Meeting] Displaying local stream with tracks:", 
              localStream.getTracks().map(t => `${t.kind}:${t.enabled}`).join(', '));
  
  // Force a clean slate for the video element
  if (localVideo.srcObject) {
      localVideo.srcObject = null;
  }
  
  // Set the stream and ensure muted for local preview
  localVideo.srcObject = localStream;
  localVideo.muted = true;
  
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
      userMessage = "Camera or microphone is in use by another application or encountered a hardware error.";
      break;
    case "OverconstrainedError": // Constraints not met
      userMessage = "Your camera/microphone doesn't meet the required specifications.";
      break;
    case "AbortError": // Request aborted
      userMessage = "Media access request was aborted. Please try again.";
      break;
    case "TypeError": // Constraints invalid
      userMessage = "Invalid camera/microphone configuration.";
      break;
    default: // Unknown error
      if (error.message && error.message.includes("timeout")) {
        userMessage = "Media access timed out. Please check your devices and refresh.";
      } else {
        userMessage = "An error occurred while accessing your camera/microphone. Please refresh and try again.";
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
  // Stop all local media tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
      console.log(`[Meeting] Stopped local ${track.kind} track.`);
    });
    localStream = null;
  }
  
  // Close all peer connections
  Object.keys(peers).forEach(user => {
    if (peers[user]) {
      peers[user].close();
      console.log(`[Meeting] Closed peer connection with ${user}.`);
    }
  });
  
  // Clear the peers object
  Object.keys(peers).forEach(user => delete peers[user]);
}

// --- WebRTC Peer Connection Handling ---

/**
 * Creates a new RTCPeerConnection for a given remote user.
 * @param {string} remoteUser - The username of the remote peer.
 * @returns {Promise<RTCPeerConnection | null>} A promise resolving with the created peer, or null on failure.
 */
async function createPeer(remoteUser) {
  if (peers[remoteUser]) {
    console.warn(`[Meeting] Peer connection already exists for ${remoteUser}.`);
    return peers[remoteUser];
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
    console.log(`[ICE] State with ${remoteUser}:`, peer.iceConnectionState);
    console.log(`[Meeting] ICE connection state with ${remoteUser}: ${peer.iceConnectionState}`);
    if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected") {
      console.warn(`[Meeting] ICE connection with ${remoteUser} is ${peer.iceConnectionState}.`);
      // Consider reconnection logic here
    }
  };

  /** Handles remote tracks being added. */
  peer.ontrack = (event) => {
    console.log(`[Meeting] Received ${event.track.kind} track from ${remoteUser}.`);
    console.log(`[Track Debug] Track type: ${event.track.kind}, ID: ${event.track.id}, Enabled: ${event.track.enabled}`);

    // Create or get the video element for this user
    let videoElement = document.getElementById(`video-${remoteUser}`);
    if (!videoElement) {
      // Create new video container and element
      const videoContainer = document.createElement("div");
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
      
      console.log(`[Meeting] Created new video element for ${remoteUser}.`);
    }
    
    // Get or create a MediaStream for this user
    if (!videoElement.srcObject) {
      videoElement.srcObject = new MediaStream();
    }
    
    // Add the track to the stream
    const remoteStream = videoElement.srcObject;
    // Check if track of same type already exists and remove it
    const existingTrack = remoteStream.getTracks().find(t => t.kind === event.track.kind);
    if (existingTrack) {
      remoteStream.removeTrack(existingTrack);
    }
    remoteStream.addTrack(event.track);
    
    // Play the video (with error handling)
    videoElement.play().catch(error => {
      console.error(`❌ [Meeting] Error playing remote video for ${remoteUser}:`, error);
    });
  };

  /** Handles negotiation needed events. */
  peer.onnegotiationneeded = async () => {
    try {
      if (isMakingOffer) {
        console.warn(`[Meeting] Negotiation already in progress for ${remoteUser}.`);
        return;
      }
      
      isMakingOffer = true;
      console.log(`[Meeting] Creating offer for ${remoteUser}...`);
      
      // Create and set local description
      const offer = await peer.createOffer();
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
      peer.addTrack(track, localStream);
      console.log(`[Meeting] Added local ${track.kind} track to peer connection with ${remoteUser}.`);
    });
  } else {
    console.warn(`[Meeting] No local stream available to share with ${remoteUser}.`);
  }

  // Apply E2EE if enabled (this will be a no-op if E2EE is not enabled)
  if (typeof e2eeManager !== "undefined" && e2eeManager) {
    console.log(`[Meeting] Applying E2EE to peer connection with ${remoteUser}.`);
    e2eeManager.setupPeerConnection(peer);
  }

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
    const peer = await createPeer(user);
    if (!peer) {
      console.error(`[Meeting] Failed to create peer connection for ${user}.`);
      return;
    }
    
    // Set polite flag (the joiner is polite)
    isPolite = true;
    
    // The existing user initiates the connection
    // (negotiationneeded event will trigger offer creation)
  } catch (error) {
    console.error(`❌ [Meeting] Error handling new user ${user}:`, error);
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
    // Get or create peer connection
    let peer = peers[user];
    if (!peer) {
      peer = await createPeer(user);
      if (!peer) {
        throw new Error(`Failed to create peer connection for ${user}.`);
      }
    }
    
    // Handle potential glare (both peers creating offers simultaneously)
   const offerCollision = (peer.signalingState !== "stable" || isMakingOffer);
isPolite = true;

if (offerCollision) {
  if (!isPolite) {
    console.warn(`[Meeting] Offer collision detected with ${user}, ignoring (not polite).`);
    return;
  }
  console.warn(`[Meeting] Offer collision with ${user}, rolling back.`);
  await peer.setLocalDescription({ type: "rollback" });
}

await peer.setRemoteDescription(offer);
console.log(`[Meeting] Set remote offer from ${user}.`);

const answer = await peer.createAnswer();
await peer.setLocalDescription(answer);

ws.send(JSON.stringify({
  type: "answer",
  answer: peer.localDescription,
  room,
  user: name,
  targetUser: user
}));

    
    // Create and send answer
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
      console.error(`[Meeting] No peer connection exists for ${user}.`);
      return;
    }
    
    // Set the remote description
    await peer.setRemoteDescription(answer);
    console.log(`[Meeting] Set remote description for ${user}.`);
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
      console.error(`[Meeting] No peer connection exists for ${user}.`);
      return;
    }
    
    // Add the ICE candidate
   try {
  await peer.addIceCandidate(candidate);
} catch (error) {
  console.error(`❌ [ICE] Failed to add candidate from ${user}:`, error);
}

    // console.log(`[Meeting] Added ICE candidate for ${user}.`); // Verbose
  } catch (error) {
    console.error(`❌ [Meeting] Error handling ICE candidate from ${user}:`, error);
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
  if (peers[user]) {
    peers[user].close();
    delete peers[user];
    console.log(`[Meeting] Closed peer connection with ${user}.`);
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
  messageElement.innerHTML = `<strong>${user}:</strong> ${text}`;
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

/**
 * Toggles the visibility of the chat container.
 */
function toggleChat() {
  const chatContainer = document.getElementById("chat-container");
  if (chatContainer) {
    chatContainer.classList.toggle("visible");
    
    // If opening the chat, focus the input field
    if (chatContainer.classList.contains("visible")) {
      chatInputField.focus();
      
      // Remove new message indicator
      const chatButton = document.querySelector("button[onclick='toggleChat()']");
      if (chatButton) {
        chatButton.classList.remove("new-message");
      }
    }
  }
}

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
  handleChatMessage(name, text);
  
  // Clear the input field
  chatInputField.value = "";
}

/**
 * Toggles the mute state of the local audio track.
 */
function toggleMute() {
  if (!localStream) return;
  
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) {
    console.warn("[Meeting] No audio track found.");
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
  }
  
  console.log(`[Meeting] Microphone ${isMuted ? "muted" : "unmuted"}.`);
}

/**
 * Toggles the enabled state of the local video track.
 */
function toggleVideo() {
  if (!localStream) return;
  
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    console.warn("[Meeting] No video track found.");
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
  }
  
  console.log(`[Meeting] Camera ${isVideoOff ? "turned off" : "turned on"}.`);
}

/**
 * Shares the user's screen.
 */
async function shareScreen() {
  try {
    // Request screen sharing
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
    
    console.log("[Meeting] Screen sharing started.");
    
    // Get the video track from the screen stream
    const screenTrack = screenStream.getVideoTracks()[0];
    
    // Replace the camera track with the screen track in all peer connections
    Object.values(peers).forEach(peer => {
      const senders = peer.getSenders();
      const videoSender = senders.find(sender => sender.track && sender.track.kind === "video");
      if (videoSender) {
        videoSender.replaceTrack(screenTrack);
      }
    });
    
    // Update the local video display
    const oldStream = localVideo.srcObject;
    localVideo.srcObject = screenStream;
    
    // When screen sharing stops (user clicks "Stop sharing")
    screenTrack.onended = async () => {
      console.log("[Meeting] Screen sharing stopped.");
      
      // Revert to camera
      if (localStream) {
        const cameraTrack = localStream.getVideoTracks()[0];
        if (cameraTrack) {
          // Replace the screen track with the camera track in all peer connections
          Object.values(peers).forEach(peer => {
            const senders = peer.getSenders();
            const videoSender = senders.find(sender => sender.track && sender.track.kind === "video");
            if (videoSender) {
              videoSender.replaceTrack(cameraTrack);
            }
          });
          
          // Update the local video display
          localVideo.srcObject = localStream;
        }
      }
    };
  } catch (error) {
    console.error("❌ [Meeting] Error sharing screen:", error);
    alert(`Screen sharing failed: ${error.name}. ${error.message}`);
  }
}

/**
 * Leaves the meeting and redirects to the dashboard.
 */
function leaveMeeting() {
  console.log("[Meeting] Leaving meeting...");
  
  // Clean up resources
  _cleanupResources();
  
  // Close the WebSocket connection
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  
  // Redirect to the dashboard
  window.location.href = "dashboard.html";
}

/**
 * Sets up event listeners for UI elements.
 * @private
 */
function _setupUIEventListeners() {
  // Chat input field: Send message on Enter key
  chatInputField.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });
  
  // Add CSS for loading indicator
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
      top: 0;
      right: 0;
      width: 8px;
      height: 8px;
      background-color: #ff4d4d;
      border-radius: 50%;
    }
  `;
  document.head.appendChild(style);
}

// --- Expose functions to the global scope ---
window.toggleChat = toggleChat;
window.toggleParticipants = toggleParticipants;
window.sendMessage = sendMessage;
window.toggleMute = toggleMute;
window.toggleVideo = toggleVideo;
window.shareScreen = shareScreen;
window.leaveMeeting = leaveMeeting;
