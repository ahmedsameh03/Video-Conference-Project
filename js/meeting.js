// /js/meeting.js

// Parse URL Parameters
const queryParams = getQueryParams();
const room = queryParams.room;
const name = queryParams.name;
let isMuted = false;
let isVideoOff = false;

// WebRTC and UI Elements
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

// ——— Combined STUN + TURN ———
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

// ——— Signaling Handlers ———
ws.onopen = () => {
  console.log("✅ WebSocket connected!");
  // join has no target
  ws.send(JSON.stringify({ type: "join", room, user: name }));
  addParticipant(name);
  startCamera();
};

ws.onerror = (error) => {
  console.error("❌ WebSocket Error:", error);
  alert("WebSocket connection error.");
};

ws.onclose = (event) => {
  console.log("🔌 WebSocket closed:", event.code, event.reason);
  if (!event.wasClean) alert("Connection closed unexpectedly.");
};

ws.onmessage = async (message) => {
  const data = JSON.parse(message.data);
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
      console.warn("Unknown message:", data);
  }
};

// ——— Media Setup ———
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("meeting-id-display")?.textContent = `#${room}`;
  document.getElementById("user-name-display")?.textContent = name;
});

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.muted = true;
  } catch (e) {
    alert(`Camera error: ${e.message}`);
  }
}

// ——— Peer Connection ———
function createPeer(remoteUser) {
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: "candidate",
        room,
        user: name,       // our ID
        target: remoteUser, // whom to send it to
        candidate: e.candidate
      }));
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log(`ICE state (${remoteUser}):`, peer.iceConnectionState);
  };
  peer.onconnectionstatechange = () => {
    console.log(`Conn state (${remoteUser}):`, peer.connectionState);
  };

  peer.ontrack = (e) => {
    addVideoStream(e.streams[0], remoteUser);
  };

  // add our tracks
  localStream.getTracks().forEach(t => peer.addTrack(t, localStream));

  peers[remoteUser] = peer;
}

// ——— Offer / Answer ———
async function createOffer(remoteUser) {
  if (!peers[remoteUser]) createPeer(remoteUser);
  const offer = await peers[remoteUser].createOffer();
  await peers[remoteUser].setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: "offer",
    room,
    user: name,         // our ID
    target: remoteUser, // whom to send it to
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
    user: name,         // our ID
    target: remoteUser, // whom to send it to
    answer
  }));
}

// ——— UI Helpers ———
function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  const container = document.createElement("div");
  container.className = "video-container";
  container.setAttribute("data-user-container", user);

  const videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.setAttribute("data-user", user);

  const nameTag = document.createElement("p");
  nameTag.textContent = user;

  container.append(videoEl, nameTag);
  videoGrid.appendChild(container);
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
  participantsList.appendChild(p);
}

function removeParticipant(user) {
  document.getElementById(`participant-${user}`)?.remove();
}

// ——— Chat ———
function sendMessage() {
  const txt = chatInputField.value.trim();
  if (!txt) return;
  ws.send(JSON.stringify({ type: "chat", room, user: name, text: txt }));
  displayMessage({ user: name, text: txt, own: true });
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
function toggleMute() { /* … */ }
function toggleVideo() { /* … */ }
async function shareScreen() { /* … */ }
function stopScreenShare() { /* … */ }
function toggleChat() { /* … */ }
function toggleParticipants() { /* … */ }
function leaveMeeting() {
  localStream.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(p => p.close());
  ws.send(JSON.stringify({ type: "leave", room, user: name }));
  ws.close();
  window.location.href = "dashboard.html";
}
