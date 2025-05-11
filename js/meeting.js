// /js/meeting.js

// Utility: parse URL parameters
function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}

// Extract room & user name
const { room, name } = getQueryParams();
let isMuted = false;
let isVideoOff = false;

// UI Elements
const localVideo = document.getElementById("large-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");

// ——— Dynamic WebSocket URL ———
const SIGNALING_SERVER_URL = window.location.hostname === "localhost"
  ? "ws://localhost:3001"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production.up.railway.app`;

console.log("🔗 Connecting to signaling server at", SIGNALING_SERVER_URL);
const ws = new WebSocket(SIGNALING_SERVER_URL);

// ——— Combined STUN + TURN servers ———
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: ["turn:a.relay.metered.ca:443?transport=tcp"],
    username: "openai",
    credential: "openai"
  }
];

const peers = {};
let localStream;
let screenStream, screenVideoElement;

// ——— WebSocket handlers ———
ws.onopen = () => {
  console.log("✅ WebSocket connected!");
  ws.send(JSON.stringify({ type: "join", room, user: name }));
  addParticipant(name);
  startCamera();
};

ws.onerror = (err) => {
  console.error("❌ WebSocket error:", err);
  alert("WebSocket connection error. Check console for details.");
};

ws.onclose = (evt) => {
  console.log("🔌 WebSocket closed:", evt.code, evt.reason);
  if (!evt.wasClean) alert("Connection closed unexpectedly.");
};

ws.onmessage = async (msg) => {
  const data = JSON.parse(msg.data);
  console.log("📩 Received:", data);
  switch (data.type) {
    case "new-user":
      addParticipant(data.user);
      if (localStream) await createOffer(data.user);
      break;
    case "offer":
      await createAnswer(data.offer, data.user);
      break;
    case "answer":
      if (peers[data.user]) {
        await peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
      }
      break;
    case "candidate":
      if (peers[data.user]) {
        await peers[data.user].addIceCandidate(new RTCIceCandidate(data.candidate));
      }
      break;
    case "user-left":
      removeVideoStream(data.user);
      removeParticipant(data.user);
      break;
    case "chat":
      displayMessage({ user: data.user, text: data.text, own: false });
      break;
    default:
      console.warn("Unknown message type:", data.type);
  }
};

// ——— Show room & user in UI ———
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("meeting-id-display")?.textContent = `#${room}`;
  document.getElementById("user-name-display")?.textContent = name;
});

// ——— Start camera & mic ———
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log("✅ Local media stream obtained.");
    localVideo.srcObject = localStream;
    localVideo.muted = true;
  } catch (e) {
    console.error("❌ getUserMedia error:", e);
    alert(`Error accessing camera/microphone: ${e.message}`);
  }
}

// ——— Create & configure peer connection ———
function createPeer(remoteUser) {
  console.log(`🤝 Creating peer connection for ${remoteUser}`);
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // ICE candidate handling
  peer.onicecandidate = ({ candidate }) => {
    if (candidate) {
      ws.send(JSON.stringify({
        type: "candidate",
        room,
        user: name,
        target: remoteUser,
        candidate
      }));
    }
  };
  // ICE / connection state logging
  peer.oniceconnectionstatechange = () =>
    console.log(`🔌 ICE state (${remoteUser}):`, peer.iceConnectionState);
  peer.onconnectionstatechange = () =>
    console.log(`🌐 Conn state (${remoteUser}):`, peer.connectionState);

  // Remote track handling
  peer.ontrack = ({ streams: [stream] }) => {
    console.log(`🎞️ Track received from ${remoteUser}`);
    addVideoStream(stream, remoteUser);
  };

  // Add our local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }

  peers[remoteUser] = peer;
}

// ——— Offer & Answer flows ———
async function createOffer(remoteUser) {
  if (!peers[remoteUser]) createPeer(remoteUser);
  const offer = await peers[remoteUser].createOffer();
  await peers[remoteUser].setLocalDescription(offer);
  ws.send(JSON.stringify({
    type: "offer",
    room,
    user: name,
    target: remoteUser,
    offer
  }));
}

async function createAnswer(offer, remoteUser) {
  if (!peers[remoteUser]) createPeer(remoteUser);
  await peers[remoteUser].setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peers[remoteUser].createAnswer();
  await peers[remoteUser].setLocalDescription(answer);
  ws.send(JSON.stringify({
    type: "answer",
    room,
    user: name,
    target: remoteUser,
    answer
  }));
}

// ——— Video & participant UI ———
function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  const container = document.createElement("div");
  container.className = "video-container";
  container.dataset.userContainer = user;

  const videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.dataset.user = user;

  const nameTag = document.createElement("p");
  nameTag.textContent = user;

  container.append(videoEl, nameTag);
  videoGrid.append(container);
}

function removeVideoStream(user) {
  document.querySelector(`div[data-user-container="${user}"]`)?.remove();
  peers[user]?.close();
  delete peers[user];
}

function addParticipant(user) {
  if (document.getElementById(`participant-${user}`)) return;
  const p = document.createElement("p");
  p.id = `participant-${user}`;
  p.textContent = user;
  participantsList.append(p);
}

function removeParticipant(user) {
  document.getElementById(`participant-${user}`)?.remove();
}

// ——— Chat ———
function sendMessage() {
  const text = chatInputField.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "chat", room, user: name, text }));
  displayMessage({ user: name, text, own: true });
  chatInputField.value = "";
}

function displayMessage({ user, text, own }) {
  const p = document.createElement("p");
  p.innerHTML = `<strong>${user}:</strong> ${text}`;
  if (own) p.classList.add("own-message");
  chatMessages.append(p);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ——— Controls ———
function toggleMute() {
  if (!localStream) return console.error("No local stream");
  const [track] = localStream.getAudioTracks();
  if (!track) return;
  isMuted = !isMuted;
  track.enabled = !isMuted;
  console.log(`🎤 Audio ${isMuted ? "muted" : "unmuted"}`);
  const btn = document.getElementById("mute-btn");
  btn?.classList.toggle("active", isMuted);
  if (btn) btn.textContent = isMuted ? "Unmute" : "Mute";
}

function toggleVideo() {
  if (!localStream) return console.error("No local stream");
  const [track] = localStream.getVideoTracks();
  if (!track) return;
  isVideoOff = !isVideoOff;
  track.enabled = !isVideoOff;
  console.log(`📹 Video ${isVideoOff ? "off" : "on"}`);
  const btn = document.getElementById("video-btn");
  btn?.classList.toggle("active", isVideoOff);
  if (btn) btn.textContent = isVideoOff ? "Show Video" : "Hide Video";
}

async function shareScreen() {
  console.log("🖥️ Attempting to share screen...");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideoElement = document.createElement("video");
    screenVideoElement.srcObject = screenStream;
    screenVideoElement.autoplay = true;
    screenVideoElement.id = "screen-share";
    videoGrid.append(screenVideoElement);

    Object.values(peers).forEach(peer => {
      const sender = peer.getSenders().find(s => s.track?.kind === "video");
      sender?.replaceTrack(screenStream.getVideoTracks()[0]);
    });

    screenStream.getVideoTracks()[0].onended = () => {
      console.log("🛑 Screen share ended.");
      stopScreenShare();
    };
  } catch (e) {
    console.error("❌ Screen share error:", e);
    alert(`Error sharing screen: ${e.message}`);
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

function toggleChat() {
  document.getElementById("chat-container")?.classList.toggle("visible");
}

function toggleParticipants() {
  document.getElementById("participants-container")?.classList.toggle("visible");
}

function leaveMeeting() {
  if (!confirm("Are you sure you want to leave?")) return;
  localStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(p => p.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}
