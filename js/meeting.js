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

console.log("🔗 Connecting to signaling server at", SIGNALING_SERVER_URL);
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
  checkMediaPermissions(); 
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
    console.error("❌ Failed during WebSocket open sequence (camera/join):", error);
    // Error already alerted in startCameraAndMic or handleGetUserMediaError
    // Optionally, provide a more generic failure message here
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
        console.warn("Cannot display local stream: stream is null.");
        return;
    }
    if (!localVideo) {
        console.warn("Cannot display local stream: localVideo element not found.");
        return;
    }

    console.log("📺 Displaying local stream...");
    localVideo.srcObject = localStream;
    localVideo.muted = true; // Mute self view
    try {
        // Use a timeout for the play() promise to catch potential hangs/timeouts
        await Promise.race([
            localVideo.play(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("play() timed out after 10 seconds")), 10000))
        ]);
        console.log("✅ Local video playback started successfully.");
    } catch (error) {
        // Catch AbortError specifically, others are more critical
        if (error.name === "AbortError") {
            console.warn("⚠️ Local video play() was aborted. This might happen during setup or if the stream was stopped.");
        } else {
            console.error(`❌ Local video play failed: ${error.name} - ${error.message}`);
            alert(`Could not play local video: ${error.name}. Check browser console for details.`);
            // Consider stopping tracks if playback fails critically
            // localStream.getTracks().forEach(track => track.stop());
            // localStream = null;
        }
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
        
        console.log(`Handling offer from ${data.user}. Politeness: ${isPolite ? 'polite' : 'impolite'}. Collision: ${offerCollision}. Signaling State: ${offeringPeer.signalingState}`);

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
          if (candidatePeer.remoteDescription && candidatePeer.remoteDescription.type && candidatePeer.connectionState !== 'closed') {
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
                if (peer.remoteDescription && peer.remoteDescription.type && peer.connectionState !== 'closed') {
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
      addVideoStream(event.streams[0], user);
    } else {
      console.warn(`⚠️ No streams associated with track received from ${user}. Adding track directly.`);
      // Fallback: Create a new stream for the track if none exists
      const newStream = new MediaStream([event.track]);
      addVideoStream(newStream, user);
    }
  };

  // Add local tracks *if* localStream is available
  if (localStream) {
    localStream.getTracks().forEach(track => {
      console.log(`➕ Adding local ${track.kind} track for ${user}`);
      try {
         peer.addTrack(track, localStream);
      } catch (e) {
         console.error(`❌ Error adding local ${track.kind} track for ${user}:`, e);
      }
    });
  } else {
      console.warn(`⚠️ Cannot add local tracks for ${user}: localStream is not available.`);
  }

  peers[user] = peer;

  // Setup E2EE for this new peer connection if enabled
  if (typeof setupE2EEForPeer === "function") { // Check if function exists (from meeting-e2ee.js)
      setupE2EEForPeer(peer);
  }

  return peer;
}

async function createOffer(user) {
  if (!peers[user]) {
    console.error(`Cannot create offer: No peer connection for ${user}`);
    return;
  }
  const peer = peers[user];
  
  // Perfect negotiation check
  if (peer.signalingState !== "stable") {
      console.warn(`⚠️ Cannot create offer for ${user}, signaling state is ${peer.signalingState}.`);
      return;
  }

  console.log(`📤 Creating offer for ${user}...`);
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

function addVideoStream(stream, user) {
  console.log(`➕ Adding video stream for user: ${user}`);
  let videoElement = document.getElementById(`video-${user}`);
  if (!videoElement) {
    const videoContainer = document.createElement("div");
    videoContainer.id = `container-${user}`;
    videoContainer.className = "video-container small-video-container"; // Add class for styling

    videoElement = document.createElement("video");
    videoElement.id = `video-${user}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true; // Important for mobile
    videoElement.className = "small-video"; // Add class for styling

    const nameTag = document.createElement("div");
    nameTag.className = "video-name-tag";
    nameTag.textContent = user;

    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(nameTag);
    videoGrid.appendChild(videoContainer);
  }

  // Check if stream is already assigned or if it's the same stream
  if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
      console.log(`✅ Stream assigned to video element for ${user}`);
      // Attempt to play, handle errors
      videoElement.play().catch(error => {
          if (error.name !== "AbortError") { // Ignore AbortError
              console.error(`❌ Error playing video for ${user}:`, error);
          }
      });
  } else {
       console.log(`Stream already assigned for ${user}`);
  }
}

function removeVideoStream(user) {
  console.log(`➖ Removing video stream for user: ${user}`);
  const videoContainer = document.getElementById(`container-${user}`);
  if (videoContainer) {
    const videoElement = videoContainer.querySelector("video");
    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
    }
    videoContainer.remove();
  }
}

// Combined function to remove peer and associated UI
function removePeer(user) {
    if (peers[user]) {
        console.log(`🔌 Closing peer connection for ${user}`);
        peers[user].close();
        delete peers[user];
    }
    removeVideoStream(user);
    removeParticipant(user);
}

function addParticipant(user) {
  if (document.getElementById(`participant-${user}`)) return; // Already exists
  
  const participantItem = document.createElement("li");
  participantItem.id = `participant-${user}`;
  participantItem.textContent = user;
  if (user === name) {
      participantItem.textContent += " (You)";
      participantItem.style.fontWeight = "bold";
  }
  participantsList.appendChild(participantItem);
}

function removeParticipant(user) {
  const participantItem = document.getElementById(`participant-${user}`);
  if (participantItem) {
    participantItem.remove();
  }
}

function sendMessage() {
  const text = chatInputField.value.trim();
  if (text) {
    ws.send(JSON.stringify({ type: "chat", text, room, user: name }));
    displayMessage({ user: name, text, own: true });
    chatInputField.value = "";
  }
}

function displayMessage({ user, text, own }) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("chat-message");
  if (own) {
    messageElement.classList.add("own-message");
  }
  messageElement.innerHTML = `<strong>${own ? "You" : user}:</strong> ${escapeHTML(text)}`;
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
}

function escapeHTML(str) {
    return str.replace(/[&<>'"/]/g, function (tag) {
        const chars = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;',
            '/': '&#x2F;'
        };
        return chars[tag] || tag;
    });
}

function toggleMute() {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
  }
  const muteBtn = document.getElementById("mute-btn");
  muteBtn.innerHTML = isMuted ? 
    '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="bi bi-mic-mute-fill" viewBox="0 0 16 16"><path d="M13 8c0 .564-.094 1.107-.266 1.613l-.814-.814A4.02 4.02 0 0 0 12 8V7a.5.5 0 0 1 1 0v1zm-5 4c.818 0 1.578-.245 2.212-.667l.718.719a4.973 4.973 0 0 1-2.43.923V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 1 0v1a4 4 0 0 0 4 4zm3-9v4.879L5.158 2.117A3.999 3.999 0 0 1 8 3c1.355 0 2.543.708 3.234 1.766L10 5.121V3a.5.5 0 0 1 1 0z"/><path d="M9.486 10.607 5 6.12V8a3 3 0 0 0 4.486 2.607zm-7.84-9.253 12 12 .708-.707-12-12-.708.707z"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="bi bi-mic-fill" viewBox="0 0 16 16"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V3z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z"/></svg>';
  console.log(isMuted ? "🎤 Mic muted" : "🎤 Mic unmuted");
}

function toggleVideo() {
  isVideoOff = !isVideoOff;
  if (localStream) {
    localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
  }
  const videoBtn = document.getElementById("video-btn");
  videoBtn.innerHTML = isVideoOff ?
    '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="bi bi-camera-video-off-fill" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M10.961 12.365a1.99 1.99 0 0 0 .522-1.103l3.11 1.382A1 1 0 0 0 16 11.731V4.269a1 1 0 0 0-1.406-.913l-3.111 1.382A2 2 0 0 0 9.5 3H4.272l6.69 9.365zm-10.114-9.03a.5.5 0 0 0-.434-.73L.185 3.407a.5.5 0 0 0-.16.631l.5 1.25.16.396 1.011 2.528 1.427 3.566.09.224.08.202l.25 1.5a.5.5 0 0 0 .434.73h7.441l.33-.462.44-.617.943-1.32.666-.933l.44-.617.16-.223.823-1.15.207-.29l.126-.176L16 4.269v7.462l-4.793-2.13z"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="bi bi-camera-video-fill" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M0 5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.983 1.738l3.11-1.382A1 1 0 0 1 16 4.269v7.462a1 1 0 0 1-1.406.913l-3.111-1.382A2 2 0 0 1 9.5 13H2a2 2 0 0 1-2-2V5z"/></svg>';
  console.log(isVideoOff ? "📹 Video off" : "📹 Video on");
}

function endCall() {
  console.log("📞 Ending call...");
  ws.close(); // This will trigger onclose handler for cleanup
  // Redirect or update UI to indicate call ended
  alert("Call ended.");
  // Optionally redirect to a different page
  // window.location.href = "/dashboard.html"; 
}

// Event listeners for controls
document.getElementById("mute-btn")?.addEventListener("click", toggleMute);
document.getElementById("video-btn")?.addEventListener("click", toggleVideo);
document.getElementById("end-call-btn")?.addEventListener("click", endCall);
document.getElementById("send-chat-btn")?.addEventListener("click", sendMessage);
document.getElementById("chat-input-field")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

// E2EE controls (assuming meeting-e2ee.js adds these functions)
document.getElementById("e2ee-toggle-btn")?.addEventListener("click", () => {
    if (typeof toggleE2EESettings === "function") toggleE2EESettings();
});
document.getElementById("e2ee-enable-btn")?.addEventListener("click", () => {
    if (typeof enableE2EE === "function") enableE2EE();
});
document.getElementById("e2ee-disable-btn")?.addEventListener("click", () => {
    if (typeof disableE2EE === "function") disableE2EE();
});

// Handle page unload/close
window.addEventListener("beforeunload", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
});

console.log("meeting.js loaded and initialized.");

