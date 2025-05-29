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
let isPolite = false;

document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }
  await testLocalStream();
});

async function testLocalStream() {
  console.log("🧪 Testing local camera and microphone...");
  try {
    const testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log("✅ Test Stream successful! Tracks:", testStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
    localVideo.srcObject = testStream;
    localVideo.muted = true;
    await localVideo.play().catch(e => console.error("❌ Test Video play failed:", e));
    testStream.getTracks().forEach(track => track.stop());
    console.log("🧪 Test completed. Local camera and microphone are working.");
  } catch (error) {
    console.error("❌ Test Stream failed:", error.name, error.message);
    alert(`Test failed: ${error.message}. Please check camera and microphone permissions.`);
  }
}

async function fetchIceServers() {
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: [
        "stun:fr-turn7.xirsys.com",
        "turn:fr-turn7.xirsys.com:80?transport=udp",
        "turn:fr-turn7.xirsys.com:3478?transport=udp",
        "turn:fr-turn7.xirsys.com:80?transport=tcp",
        "turn:fr-turn7.xirsys.com:3478?transport=tcp",
        "turns:fr-turn7.xirsys.com:443?transport=tcp",
        "turns:fr-turn7.xirsys.com:5349?transport=tcp"
      ],
      username: "YOUR_XIRSYS_USERNAME", // Replace with your Xirsys username
      credential: "YOUR_XIRSYS_CREDENTIAL" // Replace with your Xirsys credential
    },
    {
      urls: "turn:turn.anyfirewall.com:3478?transport=tcp",
      username: "webrtc",
      credential: "webrtc"
    }
  ];
}

ws.onopen = async () => {
  console.log("✅ WebSocket connected successfully!");
  try {
    await startCamera();
    if (!localStream || !localStreamplastic
.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available.");
    }
    console.log("📹 Local Stream initialized with tracks:", localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);
  } catch (error) {
    console.error("❌ Failed to start camera:", error);
    alert("Camera/Mic failed. Please check permissions and try again.");
  }
};

ws.onerror = (error) => {
  console.error("❌ WebSocket Error:", error);
  alert("WebSocket connection error. Please refresh the page or check your internet connection.");
};

ws.onclose = (event) => {
  console.log("🔌 WebSocket connection closed:", event.code, event.reason);
  if (!event.wasClean) {
    alert("WebSocket connection closed unexpectedly. Please try refreshing the page.");
  }
};

ws.onmessage = async (message) => {
  try {
    const data = JSON.parse(message.data);
    console.log("📩 WebSocket message received:", data);
    if (!data.type) return;

    switch (data.type) {
      case "new-user":
        console.log(`✨ New user joined: ${data.user}`);
        if (data.user === name) return;
        isPolite = name.localeCompare(data.user) > 0;
        addParticipant(data.user);
        if (!peers[data.user]) {
          await createPeer(data.user);
          await createOffer(data.user);
        }
        break;

      case "offer":
        console.log(`📨 Offer received from ${data.user}`);
        const peer = peers[data.user] || await createPeer(data.user);
        peer._flags = peer._flags || {};
        const offerCollision = peer._flags.makingOffer || peer.signalingState !== "stable";
        isPolite = name.localeCompare(data.user) > 0;

        if (offerCollision && !isPolite) {
          console.warn(`⚠️ Collision detected, dropping offer from ${data.user}`);
          return;
        }

        try {
          await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
          if (peer._bufferedCandidates?.length) {
            for (const c of peer._bufferedCandidates) {
              await peer.addIceCandidate(new RTCIceCandidate(c));
              console.log(`✅ Buffered ICE candidate added for ${data.user}`);
            }
            peer._bufferedCandidates = [];
          }
          console.log(`✅ Remote offer set for ${data.user}`);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          console.log(`✅ Answer created and set for ${data.user}`);
          ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
        } catch (e) {
          console.error("❌ Offer error:", e);
        }
        break;

      case "answer":
        console.log(`📬 Answer received from ${data.user}`);
        const peerAnswer = peers[data.user];
        if (peerAnswer) {
          if (peerAnswer.signalingState !== "have-local-offer") {
            console.warn(`⚠️ Ignoring answer. Invalid state: ${peerAnswer.signalingState}`);
            return;
          }
          try {
            await peerAnswer.setRemoteDescription(new RTCSessionDescription(data.answer));
            if (peerAnswer._bufferedCandidates?.length) {
              for (const c of peerAnswer._bufferedCandidates) {
                await peerAnswer.addIceCandidate(new RTCIceCandidate(c));
                console.log(`✅ Buffered ICE candidate added for ${data.user}`);
              }
              peerAnswer._bufferedCandidates = [];
            }
            console.log(`✅ Remote description (answer) set for ${data.user}`);
          } catch (e) {
            console.error("❌ Answer error:", e);
          }
        } else {
          console.warn(`⚠️ No peer connection found for ${data.user}`);
        }
        break;

      case "candidate":
        const candidatePeer = peers[data.user];
        if (candidatePeer) {
          if (candidatePeer.remoteDescription) {
            await candidatePeer.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log(`✅ ICE candidate added for ${data.user}`);
          } else {
            candidatePeer._bufferedCandidates = candidatePeer._bufferedCandidates || [];
            candidatePeer._bufferedCandidates.push(data.candidate);
            console.log(`🧊 Buffered ICE candidate for ${data.user}`);
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
    console.error("❌ Error handling WebSocket message:", error.name, error.message);
  }
};

async function startCamera() {
  console.log("🎥 Attempting to start camera and microphone...");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log("✅ Attempt 1: Both camera and microphone accessed successfully.");
  } catch (error) {
    console.warn("⚠️ Attempt 1 failed:", error.name, error.message);
    alert(`Failed to access camera and microphone: ${error.message}. Please check permissions.`);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      console.log("✅ Attempt 2: Camera only accessed successfully.");
    } catch (error2) {
      console.warn("⚠️ Attempt 2 failed:", error2.name, error2.message);
      alert(`Failed to access camera: ${error2.message}. Try enabling camera only.`);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        console.log("✅ Attempt 3: Microphone only accessed successfully.");
      } catch (error3) {
        console.error("❌ All attempts failed:", error3.name, error3.message);
        alert(`Camera/Mic failed: ${error3.message}. Please check settings.`);
        throw new Error("Failed to access camera or microphone.");
      }
    }
  }

  if (!localStream.getTracks().length) {
    throw new Error("No tracks (video or audio) available.");
  }
  console.log("✅ Final Stream Tracks:", localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
  localVideo.srcObject = localStream;
  localVideo.muted = true;
  await localVideo.play().catch(e => console.error("❌ Video play failed:", e));
  console.log("🔍 Local video element playing:", localVideo.readyState, localVideo.currentTime);
}

async function createPeer(user) {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
  const iceServers = await fetchIceServers();
  console.log("🧊 ICE Servers used:", iceServers);
  const peer = new RTCPeerConnection({ iceServers });
  peer._bufferedCandidates = [];
  peer._flags = { makingOffer: false };

  peer.oniceconnectionstatechange = () => {
    console.log(`🔌 ICE state for ${user}:`, peer.iceConnectionState);
    if (["failed", "disconnected", "closed"].includes(peer.iceConnectionState)) {
      console.error(`❌ ICE connection for ${user} failed/disconnected. State: ${peer.iceConnectionState}`);
      setTimeout(() => createPeer(user).then(() => createOffer(user)), 2000);
    }
  };

  peer.onconnectionstatechange = () => {
    console.log(`🌐 Connection state for ${user}:`, peer.connectionState);
    if (peer.connectionState === "connected") {
      console.log(`✅ Peer connection established with ${user}`);
    } else if (peer.connectionState === "failed") {
      console.error(`❌ Peer connection failed with ${user}. Retrying...`);
      setTimeout(() => createPeer(user).then(() => createOffer(user)), 2000);
    }
  };

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      console.log(`🧊 Sending ICE candidate to ${user}:`, e.candidate);
      ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate, room, user: name }));
    } else {
      console.log(`🏁 All ICE candidates sent for ${user}`);
    }
  };

  peer.onicegatheringstatechange = () => {
    console.log(`🧊 ICE gathering state for ${user}:`, peer.iceGatheringState);
  };

  peer.ontrack = (e) => {
    console.log(`🎞️ Track event for ${user}:`, e);
    if (e.streams && e.streams[0]) {
      addVideoStream(e.streams[0], user);
      console.log(`🔍 Received tracks for ${user}:`, e.streams[0].getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
    } else {
      console.warn(`⚠️ No streams received from ${user}. Check if tracks are sent.`);
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      if (!track.enabled) {
        console.warn(`⚠️ Track ${track.kind} is disabled. Enabling it...`);
        track.enabled = true;
      }
      console.log(`➕ Adding local track for ${user}:`, { kind: track.kind, enabled: track.enabled, id: track.id });
      const sender = peer.addTrack(track, localStream);
      console.log(`✅ Added ${track.kind} track with sender:`, sender);
    });
  } else {
    console.error("❌ No localStream available for peer:", user);
  }

  peers[user] = peer;
  return peer;
}

async function createOffer(user) {
  console.log(`📨 Creating offer for ${user}`);
  const peer = peers[user] || await createPeer(user);
  if (peer.signalingState !== "stable") {
    console.warn(`⚠️ Cannot create offer for ${user}, signaling state is ${peer.signalingState}`);
    return;
  }
  peer._flags.makingOffer = true;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(`✅ Offer created and set for ${user}. New signaling state:`, peer.signalingState);
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
  } catch (e) {
    console.error("❌ Error creating offer:", e);
  } finally {
    peer._flags.makingOffer = false;
  }
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  console.log(`➕ Adding video stream for ${user} with stream ID: ${stream.id}`);
  const container = document.createElement("div");
  container.classList.add("video-container");
  container.setAttribute("data-user-container", user);

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("data-user", user);

  const label = document.createElement("p");
  label.textContent = user;

  container.appendChild(video);
  container.appendChild(label);
  videoGrid.appendChild(container);
}

function removeVideoStream(user) {
  console.log(`➖ Removing video stream for ${user}`);
  const video = document.querySelector(`video[data-user="${user}"]`);
  if (video && video.parentNode) video.parentNode.remove();
  if (peers[user]) {
    peers[user].close();
    delete peers[user];
    console.log(`🗑️ Peer connection for ${user} closed and removed.`);
  }
}

function addParticipant(user) {
  if (document.getElementById(`participant-${user}`)) return;
  console.log(`➕ Adding participant: ${user}`);
  const el = document.createElement("p");
  el.id = `participant-${user}`;
  el.textContent = user;
  participantsList.appendChild(el);
}

function removeParticipant(user) {
  console.log(`➖ Removing participant: ${user}`);
  const el = document.getElementById(`participant-${user}`);
  if (el) el.remove();
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

let screenStream, screenVideo;

async function shareScreen() {
  console.log("🖥️ Attempting to share screen...");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideo = document.createElement("video");
    screenVideo.srcObject = screenStream;
    screenVideo.autoplay = true;
    screenVideo.id = "screen-share";
    videoGrid.appendChild(screenVideo);

    Object.entries(peers).forEach(([user, peer]) => {
      if (peer instanceof RTCPeerConnection) {
        const sender = peer.getSenders().find(s => s.track?.kind === "video");
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
    alert(`Error sharing screen: ${error.message}`);
  }
}

function stopScreenShare() {
  console.log("🛑 Stopping screen share...");
  screenStream?.getTracks().forEach(t => t.stop());
  if (screenVideo) {
    const container = screenVideo.closest(".video-container");
    if (container) {
      container.remove();
    } else {
      screenVideo.remove();
    }
  }
  screenStream = null;
  screenVideo = null;

  const cameraTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach(peer => {
    if (peer instanceof RTCPeerConnection) {
      const sender = peer.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(cameraTrack);
      }
    }
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

function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((v, k) => {
    params[k] = decodeURIComponent(v);
  });
  return params;
}
