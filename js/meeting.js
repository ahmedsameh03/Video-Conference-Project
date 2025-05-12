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

const peers = {};
let localStream;

// Fetch TURN Server Credentials from Metered API
async function fetchIceServers() {
  try {
    const response = await fetch("https://conferenceapp.metered.live/api/v1/turn/credentials?apiKey=fa36a42e54fe5d67d11060571f2772a0c6f6");
    if (!response.ok) {
      throw new Error(`Failed to fetch TURN credentials: ${response.statusText}`);
    }
    const iceServers = await response.json();
    console.log("✅ Fetched TURN credentials:", iceServers);
    return iceServers;
  } catch (error) {
    console.error("❌ Error fetching TURN credentials:", error);
    // Fallback to STUN server if API fails
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

ws.onopen = async () => {
  console.log("✅ WebSocket connected!");
  try {
    await startCamera();
    if (!localStream || !localStream.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available.");
    }
    console.log("📹 Local Stream Tracks:", localStream.getTracks());
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);
  } catch (error) {
    console.error("❌ Failed to start camera before joining:", error);
    alert("Failed to start camera/microphone. Please check permissions and try again.");
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
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }
});

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
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (!localStream.getVideoTracks().length || !localStream.getAudioTracks().length) {
      throw new Error("No video or audio tracks available.");
    }
    console.log("✅ Camera and microphone access granted.");
    localVideo.srcObject = localStream;
    localVideo.muted = true;
  } catch (error) {
    console.error("❌ Error accessing camera/microphone:", error);
    alert(`Error accessing camera/microphone: ${error.name} - ${error.message}. Please check permissions.`);
  }
}

ws.onmessage = async (message) => {
  try {
    const data = JSON.parse(message.data);
    console.log("📩 WebSocket message received:", data);
    if (!data.type) return;

    switch (data.type) {
      case "new-user":
        console.log(`✨ New user joined: ${data.user}`);
        addParticipant(data.user);
        if (localStream) {
          await createOffer(data.user);
        } else {
          console.warn("⚠️ Local stream not ready when new user joined.");
        }
        break;

      case "offer":
        console.log(`📨 Offer received from ${data.user}`);
        if (localStream) {
          await createAnswer(data.offer, data.user);
        } else {
          console.warn("⚠️ Local stream not ready when offer received.");
        }
        break;

      case "answer":
        console.log(`📬 Answer received from ${data.user}`);
        if (peers[data.user]) {
          await peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log(`✅ Remote description (answer) set for ${data.user}`);
        }
        break;

      case "candidate":
        console.log(`🧊 ICE candidate received from ${data.user}`);
        if (peers[data.user]) {
          try {
            await peers[data.user].addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log(`✅ ICE candidate added for ${data.user}`);
          } catch (e) {
            console.error("❌ Error adding ICE candidate:", e);
          }
        }
        break;

      case "user-left":
        console.log(`🚪 User left: ${data.user}`);
        removeVideoStream(data.user);
        removeParticipant(data.user);
        break;

      case "chat":
        console.log(`📩 Chat message received from ${data.user}: ${data.text}`);
        displayMessage({ user: data.user, text: data.text, own: data.user === name });
        break;

      default:
        console.warn(`❓ Unknown message type: ${data.type}`);
    }
  } catch (error) {
    console.error("❌ Error handling WebSocket message:", error);
  }
};

async function createPeer(user) {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
  const iceServers = await fetchIceServers(); // Fetch TURN credentials dynamically
  const peer = new RTCPeerConnection({
    iceServers: iceServers,
    iceTransportPolicy: "relay"
  });

  peer.oniceconnectionstatechange = () => {
    console.log(`🔌 ICE state for ${user}:`, peer.iceConnectionState);
    if (["failed", "disconnected", "closed"].includes(peer.iceConnectionState)) {
      console.error(`❌ ICE connection for ${user} failed/disconnected.`);
    }
  };
  peer.onconnectionstatechange = () => {
    console.log(`🌐 Connection state for ${user}:`, peer.connectionState);
    if (peer.connectionState === "connected") {
      console.log(`✅ Peer connection established with ${user}`);
    } else if (peer.connectionState === "failed") {
      console.error(`❌ Peer connection failed with ${user}`);
    }
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`🧊 Sending ICE candidate to ${user}:`, event.candidate);
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user }));
    } else {
      console.log(`🏁 All ICE candidates sent for ${user}`);
    }
  };

  peer.onicegatheringstatechange = () => {
    console.log(`🧊 ICE gathering state for ${user}:`, peer.iceGatheringState);
  };

  peer.ontrack = (event) => {
    console.log(`🎞️ Track event for ${user}:`, event);
    console.log(`🎞️ Received streams:`, event.streams);
    if (event.streams && event.streams[0]) {
      addVideoStream(event.streams[0], user);
    } else {
      console.warn(`⚠️ No streams received from ${user}.`);
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      console.log(`➕ Adding local track for ${user}:`, track.kind);
      peer.addTrack(track, localStream);
    });
  }

  peers[user] = peer;
}

async function createOffer(user) {
  console.log(`📨 Creating offer for ${user}`);
  if (!peers[user]) await createPeer(user);
  try {
    const offer = await peers[user].createOffer();
    await peers[user].setLocalDescription(offer);
    console.log(`✅ Offer ready. Sending to ${user}`);
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name })); 
  } catch (e) {
    console.error("❌ Error creating offer:", e);
  }
}

async function createAnswer(offer, user) {
  console.log(`📬 Creating answer for ${user}`);
  if (!peers[user]) await createPeer(user);
  try {
    await peers[user].setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peers[user].createAnswer();
    await peers[user].setLocalDescription(answer);
    console.log(`✅ Answer ready. Sending to ${user}`);
    ws.send(JSON.stringify({ type: "answer", answer, room, user: name })); 
  } catch (e) {
    console.error("❌ Error creating answer:", e);
  }
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  console.log(`➕ Adding video stream for ${user}`);
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
  const container = document.querySelector(`div[data-user-container="${user}"]`);
  if (container) container.remove();
  if (peers[user]) {
    peers[user].close();
    delete peers[user];
  }
}

function addParticipant(user) {
  if (document.getElementById(`participant-${user}`)) return;
  const p = document.createElement("p");
  p.textContent = user;
  p.id = `participant-${user}`;
  participantsList.appendChild(p);
}

function removeParticipant(user) {
  const p = document.getElementById(`participant-${user}`);
  if (p) p.remove();
}

function toggleMute() {
  if (!localStream) return console.error("No local stream");
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length) {
    isMuted = !isMuted;
    audioTracks[0].enabled = !isMuted;
    console.log(`🎤 Audio ${isMuted ? "muted" : "unmuted"}`);
    document.getElementById("mute-btn")?.classList.toggle("active", isMuted);
  }
}

function toggleVideo() {
  if (!localStream) return console.error("No local stream");
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length) {
    isVideoOff = !isVideoOff;
    videoTracks[0].enabled = !isVideoOff;
    console.log(`📹 Video ${isVideoOff ? "off" : "on"}`);
    document.getElementById("video-btn")?.classList.toggle("active", isVideoOff);
  }
}

let screenStream, screenVideoElement;

async function shareScreen() {
  console.log("🖥️ Attempting to share screen...");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideoElement = document.createElement("video");
    screenVideoElement.srcObject = screenStream;
    screenVideoElement.autoplay = true;
    screenVideoElement.id = "screen-share";
    videoGrid.appendChild(screenVideoElement);

    Object.values(peers).forEach(peer => {
      const sender = peer.getSenders().find(s => s.track?.kind === "video");
      sender?.replaceTrack(screenStream.getVideoTracks()[0]);
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
  screenStream?.getTracks().forEach(t => t.stop());
  screenVideoElement?.remove();
  screenStream = null;

  const cameraTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach(peer => {
    const sender = peer.getSenders().find(s => s.track?.kind === "video");
    sender?.replaceTrack(cameraTrack);
  });
}

function sendMessage() {
  const msg = chatInputField.value.trim();
  if (!msg) return;
  console.log(`💬 Sending: ${msg}`);
  ws.send(JSON.stringify({ type: "chat", user: name, text: msg, room })); 
  displayMessage({ user: name, text: msg, own: true });
  chatInputField.value = "";
}

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
  localStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(p => p.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}
