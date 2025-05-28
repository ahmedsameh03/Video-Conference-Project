// ✅ الكود الكامل بعد تطبيق Polite Peer Negotiation وحل مشكلة تكرار الفيديوهات
// 🚀 يحتوي على: WebRTC Signaling + Video Logic + منع التكرار + دعم الهاتف

// ---- إعداد المتغيرات ----
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

const ws = new WebSocket(SIGNALING_SERVER_URL);

const peers = {};
const peerMeta = {};
let localStream = null;

// ---- تحميل الصفحة ----
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("meeting-id-display").textContent = `#${room}`;
  document.getElementById("user-name-display").textContent = name;
  await testLocalStream();
});

async function testLocalStream() {
  try {
    const testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = testStream;
    localVideo.muted = true;
    await localVideo.play();
    testStream.getTracks().forEach(track => track.stop());
  } catch (error) {
    alert(`Camera/Mic test failed: ${error.message}`);
  }
}

ws.onopen = async () => {
  try {
    await startCamera();
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);
    addVideoStream(localStream, name);
  } catch (error) {
    alert("Camera or microphone access failed.");
  }
};

// ---- الرسائل القادمة من WebSocket ----
ws.onmessage = async (message) => {
  const data = JSON.parse(message.data);
  if (!data.type) return;

  switch (data.type) {
    case "new-user":
      if (data.user === name) return;
      await createPeer(data.user, false);
      break;

    case "offer":
      await handleOffer(data);
      break;

    case "answer":
      await handleAnswer(data);
      break;

    case "candidate":
      await handleCandidate(data);
      break;

    case "user-left":
      removeVideoStream(data.user);
      removeParticipant(data.user);
      break;

    case "chat":
      displayMessage({ user: data.user, text: data.text, own: data.user === name });
      break;
  }
};

// ---- Peer Management ----
async function createPeer(user, isOfferer) {
  if (peers[user]) return;

  const peer = new RTCPeerConnection({ iceServers: await fetchIceServers() });
  peers[user] = peer;
  peerMeta[user] = { makingOffer: false, polite: name > user };

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) {
      ws.send(JSON.stringify({ type: "candidate", candidate, room, user: name }));
    }
  };

  peer.ontrack = ({ streams }) => {
    const stream = streams[0];
    if (!stream || document.querySelector(`video[data-user="${user}"]`)) {
      console.warn(`⚠️ Duplicate track ignored for ${user}`);
      return;
    }
    console.log(`🎥 Received video track from ${user}`);
    addVideoStream(stream, user);
  };

  peer.onnegotiationneeded = async () => {
    try {
      peerMeta[user].makingOffer = true;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
    } catch (e) {
      console.error("Negotiation error:", e);
    } finally {
      peerMeta[user].makingOffer = false;
    }
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      const sender = peer.getSenders().find(s => s.track?.kind === "video");
      if (sender && localStream?.getVideoTracks()?.length) {
        sender.replaceTrack(localStream.getVideoTracks()[0]);
      }
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }
}

async function handleOffer(data) {
  const peer = peers[data.user] || await createPeer(data.user, false);
  const desc = new RTCSessionDescription(data.offer);

  const ready = peer.signalingState === "stable" || peer.signalingState === "have-local-offer";
  const polite = peerMeta[data.user].polite;

  if (!ready && !polite) {
    console.warn(`🙅 Ignored offer from ${data.user}`);
    return;
  }

  try {
    await peer.setRemoteDescription(desc);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
  } catch (e) {
    console.error("Offer handling error:", e);
  }
}

async function handleAnswer(data) {
  const peer = peers[data.user];
  if (!peer) return;

  if (peer.signalingState !== "stable") {
    await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    console.log(`✅ Remote answer set for ${data.user}`);
  } else {
    console.warn(`⚠️ Ignored redundant answer for ${data.user}`);
  }
}

async function handleCandidate(data) {
  const peer = peers[data.user];
  if (!peer || !data.candidate) return;

  try {
    await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) {
    console.warn(`❌ Error adding ICE candidate:`, e.message);
  }
}

function addVideoStream(stream, user) {
  if (!stream || document.querySelector(`video[data-user="${user}"]`)) return;

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

  container.appendChild(videoEl);
  container.appendChild(nameTag);
  videoGrid.appendChild(container);
}

function removeVideoStream(user) {
  const container = document.querySelector(`div[data-user-container="${user}"]`);
  if (container) container.remove();
  if (peers[user]) {
    peers[user].close();
    delete peers[user];
    delete peerMeta[user];
  }
}

// ---- UI Utilities ----
function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
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

function displayMessage({ user, text, own }) {
  const el = document.createElement("p");
  el.innerHTML = `<strong>${user}:</strong> ${text}`;
  if (own) el.classList.add("own-message");
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessage() {
  const msg = chatInputField.value.trim();
  if (!msg) return;
  ws.send(JSON.stringify({ type: "chat", user: name, text: msg, room }));
  displayMessage({ user: name, text: msg, own: true });
  chatInputField.value = "";
}

function toggleMute() {
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  isMuted = !isMuted;
  audioTracks.forEach(track => (track.enabled = !isMuted));
}

function toggleVideo() {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  isVideoOff = !isVideoOff;
  videoTracks.forEach(track => (track.enabled = !isVideoOff));
}

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new Error("Camera and microphone access denied.");
      }
    }
  }
}

async function fetchIceServers() {
  return [
    { urls: ["stun:fr-turn7.xirsys.com"] },
    {
      urls: [
        "turn:fr-turn7.xirsys.com:80?transport=udp",
        "turn:fr-turn7.xirsys.com:3478?transport=udp",
        "turn:fr-turn7.xirsys.com:80?transport=tcp",
        "turn:fr-turn7.xirsys.com:3478?transport=tcp",
        "turns:fr-turn7.xirsys.com:443?transport=tcp",
        "turns:fr-turn7.xirsys.com:5349?transport=tcp"
      ],
      username: "L2a-fvFXKem5bHUHPf_WEX4oi-Ixl0BHHXuz4z_7KSgyjpfxuzhcVM2Tu_DfwOTUAAAAAGgpFR1haG1lZHNhbWVoMDM=",
      credential: "c3c10bb4-3372-11f0-a269-fadfa0afc433"
    }
  ];
}

// ---- Leave meeting ----
function leaveMeeting() {
  if (!confirm("Do you want to leave the meeting?")) return;
  localStream?.getTracks().forEach(track => track.stop());
  Object.values(peers).forEach(peer => peer.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "user-left", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}
window.leaveMeeting = leaveMeeting;

function toggleChat() {
  document.getElementById("chat-container")?.classList.toggle("visible");
}
window.toggleChat = toggleChat;

function toggleParticipants() {
  document.getElementById("participants-container")?.classList.toggle("visible");
}
window.toggleParticipants = toggleParticipants;
