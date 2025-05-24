// الملف: js/meeting.js

const queryParams = getQueryParams();
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

console.log("🔗 Connecting to signaling server at", SIGNALING_SERVER_URL );
const ws = new WebSocket(SIGNALING_SERVER_URL);

const peers = {}; // Stores RTCPeerConnection objects, keyed by user name
let isMakingOffer = false;
let isPolite = false;
let isSettingRemoteAnswerPending = false;
let localStream = null; // Initialize localStream to null

// Function to handle getUserMedia errors more gracefully
function handleGetUserMediaError(error, context = "startCamera") {
    console.error(`❌ ${context} Error:`, error.name, error.message, error.stack);
    let userMessage = `Failed to access camera/microphone (${context}): ${error.name}.`;

    switch (error.name) {
        case "NotAllowedError":
        case "SecurityError":
            userMessage += " Please ensure you have granted camera and microphone permissions in your browser settings for this site.";
            break;
        case "NotFoundError":
            userMessage += " No camera or microphone found. Please ensure they are connected and enabled.";
            break;
        case "NotReadableError":
            userMessage += " Camera or microphone is currently in use by another application or hardware error occurred.";
            break;
        case "OverconstrainedError":
            userMessage += " No camera/microphone found that meets the specified constraints.";
            break;
        case "AbortError":
             userMessage += " The request was aborted, possibly due to a timeout or navigation.";
             break;
        default:
            userMessage += " An unknown error occurred.";
    }
    alert(userMessage);
    // Depending on the error, you might want to disable related UI elements
}

// Simplified test function - focuses only on checking permissions/availability
async function checkMediaPermissions() {
    console.log("🧪 Checking media permissions...");
    let testStream = null;
    try {
        // Request both, but don't display or keep the stream
        testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("✅ Permission Check: Camera and microphone access seems available.");
        return true;
    } catch (error) {
        handleGetUserMediaError(error, "Permission Check");
        return false;
    } finally {
        // Stop the test stream tracks immediately
        if (testStream) {
            testStream.getTracks().forEach(track => track.stop());
            console.log("🛑 Permission check stream tracks stopped.");
        }
    }
}

// Run permission check early on DOMContentLoaded
document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }
  // Run the permission check early, but don't block WebSocket connection
  // checkMediaPermissions(); // Moved this check to happen just before getUserMedia
});

async function fetchIceServers() {
  // Using hardcoded Xirsys STUN/TURN for now
  // In production, fetch dynamically or use environment variables
  return [
    {
      urls: ["stun:fr-turn7.xirsys.com"]
    },
    {
      username: "L2a-fvFXKem5bHUHPf_WEX4oi-Ixl0BHHXuz4z_7KSgyjpfxuzhcVM2Tu_DfwOTUAAAAAGgpFR1haG1lZHNhbWVoMDM=",
      credential: "c3c10bb4-3372-11f0-a269-fadfa0afc433",
      urls: [
        "turn:fr-turn7.xirsys.com:80?transport=udp",
        "turn:fr-turn7.xirsys.com:3478?transport=udp",
        "turn:fr-turn7.xirsys.com:80?transport=tcp",
        "turn:fr-turn7.xirsys.com:3478?transport=tcp",
        "turns:fr-turn7.xirsys.com:443?transport=tcp",
        "turns:fr-turn7.xirsys.com:5349?transport=tcp"
      ]
    }
  ];
}

ws.onopen = async () => {
  console.log("✅ WebSocket connected!");
  try {
    // Check permissions *just before* attempting to get the stream
    const permissionsOk = await checkMediaPermissions();
    if (!permissionsOk) {
        throw new Error("Media permissions were not granted or available.");
    }

    // Attempt to start the camera/mic *before* joining the room
    const stream = await startCameraAndMic(); 
    if (!stream || !stream.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available after startCameraAndMic.");
    }
    localStream = stream; // Assign the successfully obtained stream
    console.log("📹 Local Stream initialized with tracks:", localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
    
    // Display local stream *after* it's confirmed and assigned
    await displayLocalStream();

    // Now join the room
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name); // Add self to participant list

  } catch (error) {
    console.error("❌ Failed during WebSocket open sequence (permissions/camera/join):", error);
    // Error should have been alerted by checkMediaPermissions or startCameraAndMic
    // Optionally, provide a more generic failure message here or disable UI
    // alert("Failed to initialize the meeting. Please check permissions and refresh.");
  }
};

ws.onerror = (error) => {
  console.error("❌ WebSocket Error:", error);
  alert("WebSocket connection error. Please check the server and your connection.");
};

ws.onclose = (event) => {
  console.log("🔌 WebSocket connection closed:", event.code, event.reason);
  if (!event.wasClean) {
    alert("WebSocket connection closed unexpectedly. Please try refreshing the page.");
  }
  // Clean up resources on close
  if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
  }
  Object.values(peers).forEach(peer => peer.close());
  peers = {};
};

function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}

// Renamed function to be more specific
async function startCameraAndMic() {
  console.log("🎥 Attempting to start camera and microphone...");
  let stream = null;
  try {
    // Prioritize getting both video and audio
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log("✅ Attempt 1: Both camera and microphone accessed successfully.");
  } catch (error) {
    console.warn("⚠️ Attempt 1 (Video+Audio) failed:", error.name, error.message);
    try {
      // Fallback to video only
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      console.log("✅ Attempt 2: Camera only accessed successfully.");
    } catch (error2) {
      console.warn("⚠️ Attempt 2 (Video Only) failed:", error2.name, error2.message);
      try {
        // Fallback to audio only
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        console.log("✅ Attempt 3: Microphone only accessed successfully.");
      } catch (error3) {
        handleGetUserMediaError(error3, "startCameraAndMic - All Attempts");
        throw error3; // Re-throw the final error to be caught by the caller (ws.onopen)
      }
    }
  }

  if (!stream || !stream.getTracks().length) {
    const error = new Error("No tracks (video or audio) available even after successful getUserMedia call.");
    handleGetUserMediaError(error, "startCameraAndMic - No Tracks");
    throw error;
  }
  
  return stream; // Return the successfully obtained stream
}

// Function to display the local stream
async function displayLocalStream() {
    if (!localStream) {
        console.error("Cannot display local stream: stream is null."); // Changed warn to error
        return;
    }
    if (!localVideo) {
        console.error("Cannot display local stream: localVideo element not found."); // Changed warn to error
        return;
    }

    console.log("📺 Displaying local stream with tracks:", 
                localStream.getTracks().map(t => `${t.kind}:${t.enabled}`).join(", "));

    // Force a clean slate for the video element
    if (localVideo.srcObject) {
        localVideo.srcObject = null;
    }

    // Set the stream and ensure muted for local preview
    localVideo.srcObject = localStream;
    localVideo.muted = true;

    try {
        // Add a visible UI indicator while waiting for video
        document.body.classList.add("loading-video");

        // Play with timeout and visual feedback
        await Promise.race([
            localVideo.play(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Video play timeout")), 8000) // Reduced timeout
            )
        ]);

        console.log("✅ Local video playback started successfully.");
    } catch (error) {
        console.error(`❌ Local video play failed: ${error.message}`);

        // Try one more time with a delay
        setTimeout(async () => {
            try {
                await localVideo.play();
                console.log("✅ Local video playback started on retry.");
            } catch (retryError) {
                console.error(`❌ Local video play retry failed: ${retryError.message}`);
                alert(`Could not display camera: ${error.name}. Please refresh and try again.`);
            } finally {
                document.body.classList.remove("loading-video");
            }
        }, 1000);
    } finally {
        // Remove loading indicator in normal case
        document.body.classList.remove("loading-video");
    }
}


// Main WebSocket message handler (will be enhanced by meeting-e2ee.js)
ws.onmessage = async (message) => {
  let data;
  try {
    data = JSON.parse(message.data);
    // console.log("📩 WebSocket message received:", data); // Reduce noise, log specific types
    if (!data || !data.type) return;

    switch (data.type) {
      case "new-user":
        console.log(`✨ New user joined: ${data.user}`);
        // Don't connect to yourself
        if (data.user === name) return;
        // Add to participant list
        addParticipant(data.user);
        // If not already connected, create a peer and send an offer
        if (!peers[data.user]) {
          const peer = await createPeer(data.user); // Create peer first
          if (peer) { // Ensure peer creation was successful
             await createOffer(data.user);
          }
        }
        break;

      case "offer":
        console.log(`📨 Offer received from ${data.user}`);
        // Ensure peer exists or create it
        const offeringPeer = peers[data.user] || await createPeer(data.user);
        if (!offeringPeer) {
            console.error(`Failed to create/get peer for offer from ${data.user}`);
            return;
        }
        
        // Handle offer collision (impolite peer ignores)
        const offerCollision = isMakingOffer || offeringPeer.signalingState !== "stable";
        // Determine politeness based on name comparison (consistent tie-breaking)
        isPolite = name.localeCompare(data.user) > 0; 
        
        console.log(`Handling offer from ${data.user}. Politeness: ${isPolite ? "polite" : "impolite"}. Collision: ${offerCollision}. Signaling State: ${offeringPeer.signalingState}`);

        if (offerCollision && !isPolite) {
          console.warn(`⚠️ Offer collision from ${data.user}, dropping offer (impolite).`);
          return;
        }
        
        // If polite and collision, potentially rollback local offer (more complex, skip for now)
        // if (offerCollision && isPolite) { ... }

        try {
          await offeringPeer.setRemoteDescription(new RTCSessionDescription(data.offer));
          console.log(`✅ Remote offer set for ${data.user}. Signaling state: ${offeringPeer.signalingState}`);
          
          // Add buffered candidates if any
          await addBufferedCandidates(offeringPeer, data.user);

          // Create and send answer
          const answer = await offeringPeer.createAnswer();
          await offeringPeer.setLocalDescription(answer);
          console.log(`✅ Answer created and set for ${data.user}. Signaling state: ${offeringPeer.signalingState}`);
          ws.send(JSON.stringify({ type: "answer", answer, room, user: name, targetUser: data.user }));
        } catch (e) {
          console.error(`❌ Failed to handle offer from ${data.user}:`, e);
        }
        break;

      case "answer":
        console.log(`📬 Answer received from ${data.user}`);
        if (peers[data.user]) {
          const answeringPeer = peers[data.user];
          try {
            // Ensure local description is set before setting remote answer
            if (answeringPeer.signalingState === "have-local-offer") {
                await answeringPeer.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log(`✅ Remote answer set for ${data.user}. Signaling state: ${answeringPeer.signalingState}`);
                // Add buffered candidates if any
                await addBufferedCandidates(answeringPeer, data.user);
            } else {
                console.warn(`⚠️ Received answer from ${data.user} but signaling state is not 'have-local-offer'. State: ${answeringPeer.signalingState}. Buffering answer might be needed.`);
                // TODO: Implement answer buffering if needed for complex scenarios
            }
          } catch (e) {
            console.error(`❌ Failed to set remote answer for ${data.user}:`, e);
          }
        } else {
          console.warn(`⚠️ No peer connection found for ${data.user} to set answer.`);
        }
        break;

      case "candidate":
        // console.log(`🧊 Candidate received from ${data.user}`); // Reduce noise
        const candidatePeer = peers[data.user];
        if (candidatePeer) {
          // Buffer candidate if remote description is not yet set or peer is closed
          if (candidatePeer.remoteDescription && candidatePeer.remoteDescription.type && candidatePeer.connectionState !== "closed") {
            try {
                await candidatePeer.addIceCandidate(new RTCIceCandidate(data.candidate));
                // console.log(`✅ ICE candidate added for ${data.user}`); // Reduce noise
            } catch (e) {
                // Ignore benign errors
                if (!e.message.includes("Cannot add ICE candidate when connection is closed") && 
                    !e.message.includes("Error processing ICE candidate") &&
                    !e.message.includes("InvalidStateError")) { // Firefox error when state is wrong
                     console.error(`❌ Error adding ICE candidate for ${data.user}:`, e);
                }
            }
          } else {
            // Buffer the candidate
            candidatePeer._bufferedCandidates = candidatePeer._bufferedCandidates || [];
            candidatePeer._bufferedCandidates.push(data.candidate);
            console.log(`🧊 Candidate buffered for ${data.user} (remote desc not set or peer closed)`);
          }
        } else {
             console.warn(`⚠️ No peer connection found for ${data.user} to add candidate.`);
        }
        break;

      case "user-left":
        console.log(`🚪 User left: ${data.user}`);
        removePeer(data.user);
        break;

      case "chat":
        console.log(`💬 Chat message received from ${data.user}: ${data.text}`);
        displayMessage({ user: data.user, text: data.text, own: data.user === name });
        break;

      // Note: 'e2ee-status' is handled by the enhanced handler in meeting-e2ee.js

      default:
        console.warn(`❓ Unknown message type received: ${data.type}`);
    }
  } catch (error) {
    console.error("❌ Error handling WebSocket message:", error.name, error.message, error.stack);
    // Avoid crashing if one message fails
  }
};

// Helper to add buffered ICE candidates
async function addBufferedCandidates(peer, user) {
    if (peer._bufferedCandidates?.length) {
        console.log(`Processing ${peer._bufferedCandidates.length} buffered ICE candidates for ${user}`);
        for (const candidate of peer._bufferedCandidates) {
            try {
                // Check state before adding
                if (peer.remoteDescription && peer.remoteDescription.type && peer.connectionState !== "closed") {
                    await peer.addIceCandidate(new RTCIceCandidate(candidate));
                    // console.log(`✅ Buffered ICE candidate added for ${user}`); // Reduce noise
                } else {
                    console.warn(`Skipping buffered candidate for ${user}, peer state not suitable.`);
                }
            } catch (e) {
                 if (!e.message.includes("Cannot add ICE candidate when connection is closed") && 
                     !e.message.includes("Error processing ICE candidate") &&
                     !e.message.includes("InvalidStateError")) {
                    console.error(`❌ Error adding buffered ICE candidate for ${user}:`, e);
                 }
            }
        }
        peer._bufferedCandidates = []; // Clear buffer
    }
}

async function createPeer(user) {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
  if (peers[user]) {
      console.warn(`Peer connection for ${user} already exists. Closing old one.`);
      peers[user].close(); // Close existing before creating new
  }

  let iceServers;
  try {
      iceServers = await fetchIceServers();
      console.log("🧊 Using ICE Servers:", JSON.stringify(iceServers));
  } catch (error) {
      console.error("❌ Failed to fetch ICE servers:", error);
      alert("Failed to get network configuration (ICE servers). Cannot establish connection.");
      return null; // Indicate failure
  }
  
  const peer = new RTCPeerConnection({
    iceServers: iceServers
  });

  // Add event listeners
  peer.oniceconnectionstatechange = () => {
    console.log(`🔌 ICE connection state for ${user}:`, peer.iceConnectionState);
    if (["failed", "disconnected", "closed"].includes(peer.iceConnectionState)) {
      console.warn(`🔌 ICE connection for ${user} state: ${peer.iceConnectionState}. May need cleanup or restart.`);
      // Consider attempting ICE restart or closing the connection more formally
      // removePeer(user); // Clean up UI and peer object if state persists
    }
  };
  peer.onconnectionstatechange = () => {
    console.log(`🌐 Connection state for ${user}:`, peer.connectionState);
    if (peer.connectionState === "connected") {
      console.log(`✅ Peer connection established with ${user}`);
    } else if (peer.connectionState === "failed") {
      console.error(`❌ Peer connection failed with ${user}. Attempting cleanup.`);
      removePeer(user); // Clean up failed connection
    } else if (peer.connectionState === "closed") {
      console.log(`🚪 Peer connection closed with ${user}.`);
      // Ensure cleanup happens if not already done
      removePeer(user);
    }
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      // console.log(`🧊 Sending ICE candidate to ${user}`); // Reduce noise
      // Send candidate to the specific target user
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user: name, targetUser: user }));
    } else {
      console.log(`🏁 All ICE candidates gathered for ${user}`);
    }
  };

  peer.onicegatheringstatechange = () => {
    // console.log(`🧊 ICE gathering state for ${user}:`, peer.iceGatheringState); // Reduce noise
  };

  peer.ontrack = (event) => {
    console.log(`🎞️ Track received from ${user}:`, event.track, `Stream(s):`, event.streams);
    if (event.streams && event.streams[0]) {
      addRemoteStream(event.streams[0], user);
    } else {
      console.warn(`⚠️ Track received from ${user} without a stream.`);
      // Handle tracks without streams if necessary (e.g., create a new stream)
    }
  };

  // Add local stream tracks to the peer connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        console.log(`➕ Adding local ${track.kind} track to peer for ${user}`);
        peer.addTrack(track, localStream);
      } catch (e) {
        console.error(`❌ Error adding local ${track.kind} track for ${user}:`, e);
      }
    });
  } else {
    console.error(`❌ Cannot add tracks for ${user}: Local stream is not initialized.`);
  }

  // Store the peer connection
  peers[user] = peer;

  // --- E2EE Integration --- 
  // Call the setup function from meeting-e2ee.js if it exists
  if (typeof setupE2EEForPeer === "function") {
    setupE2EEForPeer(peer);
  } else {
    console.warn("setupE2EEForPeer function not found. E2EE will not be applied to this peer.");
  }
  // --- End E2EE Integration ---

  return peer;
}

async function createOffer(user) {
  if (!peers[user]) {
    console.error(`Cannot create offer for ${user}: Peer connection does not exist.`);
    return;
  }
  const peer = peers[user];
  console.log(`✉️ Creating offer for ${user}...`);
  isMakingOffer = true;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(`✅ Offer created and set for ${user}. Signaling state: ${peer.signalingState}`);
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name, targetUser: user }));
  } catch (e) {
    console.error(`❌ Failed to create offer for ${user}:`, e);
  } finally {
    isMakingOffer = false;
  }
}

function addRemoteStream(stream, user) {
  console.log(`➕ Adding remote stream for user: ${user}`);
  let videoElement = document.getElementById(`video-${user}`);
  if (!videoElement) {
    videoElement = document.createElement("video");
    videoElement.id = `video-${user}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true; // Important for mobile
    videoElement.classList.add("remote-video");

    const videoContainer = document.createElement("div");
    videoContainer.id = `container-${user}`;
    videoContainer.classList.add("video-container");
    
    const nameTag = document.createElement("div");
    nameTag.classList.add("name-tag");
    nameTag.textContent = user;
    
    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(nameTag);
    videoGrid.appendChild(videoContainer);
  }
  
  videoElement.srcObject = stream;
  videoElement.play().catch(e => console.error(`Error playing remote video for ${user}:`, e));
}

function removePeer(user) {
  console.log(`➖ Removing peer and UI for user: ${user}`);
  if (peers[user]) {
    peers[user].close();
    delete peers[user];
  }
  const videoContainer = document.getElementById(`container-${user}`);
  if (videoContainer) {
    videoContainer.remove();
  }
  removeParticipant(user);
}

function displayMessage({ user, text, own }) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message");
  if (own) {
    messageElement.classList.add("own-message");
  }
  messageElement.innerHTML = `<strong>${own ? "You" : user}:</strong> ${text}`;
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
}

function sendMessage() {
  const text = chatInputField.value.trim();
  if (text) {
    const message = { type: "chat", text, room, user: name };
    ws.send(JSON.stringify(message));
    displayMessage({ user: name, text, own: true }); // Display own message immediately
    chatInputField.value = ""; // Clear input field
  }
}

// Add participant to the list
function addParticipant(user) {
    if (document.getElementById(`participant-${user}`)) return; // Already exists
    const participantElement = document.createElement("li");
    participantElement.id = `participant-${user}`;
    participantElement.textContent = user;
    participantsList.appendChild(participantElement);
}

// Remove participant from the list
function removeParticipant(user) {
    const participantElement = document.getElementById(`participant-${user}`);
    if (participantElement) {
        participantElement.remove();
    }
}

// Event listeners for UI controls
document.getElementById("mute-btn")?.addEventListener("click", () => {
  isMuted = !isMuted;
  localStream?.getAudioTracks().forEach(track => track.enabled = !isMuted);
  document.getElementById("mute-btn").textContent = isMuted ? "Unmute" : "Mute";
});

document.getElementById("video-off-btn")?.addEventListener("click", () => {
  isVideoOff = !isVideoOff;
  localStream?.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
  document.getElementById("video-off-btn").textContent = isVideoOff ? "Video On" : "Video Off";
});

document.getElementById("send-chat-btn")?.addEventListener("click", sendMessage);
document.getElementById("chat-input-field")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

document.getElementById("leave-btn")?.addEventListener("click", () => {
  ws.close();
  window.location.href = "/dashboard.html"; // Redirect to dashboard or home page
});

// E2EE related buttons (ensure these exist in your HTML)
document.getElementById("e2ee-settings-btn")?.addEventListener("click", toggleE2EESettings);
document.getElementById("e2ee-enable-btn")?.addEventListener("click", enableE2EE);
document.getElementById("e2ee-disable-btn")?.addEventListener("click", disableE2EE);

console.log("meeting.js loaded");

