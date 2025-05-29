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
let isMakingOffer = false;
let isPolite = false;
let localStream;

// Test local camera and microphone
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
    console.error("❌ Test Stream failed:", error.name, error.message, error.stack);
    alert(`Failed to test camera/microphone: ${error.message}. Please check camera and microphone permissions in the browser.`);
  }
}

// Run the test when the page loads
document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }
  await testLocalStream();
});

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
    }
  ];
}

ws.onopen = async () => {
  console.log("✅ WebSocket connected successfully!");
  try {
    await startCamera();
    if (!localStream || !localStream.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available.");
    }
    console.log("📹 Local Stream initialized with tracks:", localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);
  } catch (error) {
    console.error("❌ Failed to start camera before joining:", error);
    alert("Failed to start camera/microphone. Please check permissions and try again.");
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
    console.log("✅ Attempt 1: Both camera and microphone accessed successfully.");
  } catch (error) {
    console.warn("⚠️ Attempt 1 failed:", error.name, error.message);
    alert(`Failed to access camera and microphone: ${error.message}. Please check camera and microphone permissions.`);
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
        console.error("❌ All attempts failed:", error3.name, error3.message, error3.stack);
        alert(`Failed to access camera or microphone: ${error3.message}. Please check settings and try again.`);
        throw new Error("Failed to access camera or microphone after all attempts.");
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
}

ws.onmessage = async (message) => {
  try {
    const data = JSON.parse(message.data);
    console.log("📩 WebSocket message received:", data);
    if (!data.type) return;

    switch (data.type) {
      case "new-user":
        console.log(`✨ New user joined: ${data.user}`);
        if (data.user === name) return;
        addParticipant(data.user);
        if (!peers[data.user]) {
          await createPeer(data.user);
          await createOffer(data.user);
        }
        break;

      case "offer":
        console.log(`📨 Offer received from ${data.user}`);
        const peer = peers[data.user] || await createPeer(data.user);
        const offerCollision = isMakingOffer || peer.signalingState !== "stable";

        isPolite = name.localeCompare(data.user) > 0;
        if (offerCollision && !isPolite) {
          console.warn(`⚠️ Offer collision from ${data.user}, dropping offer`);
          return;
        }

        try {
          await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
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
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
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
            console.log(`✅ Remote description (answer) set for ${data.user}`);
          } catch (e) {
            console.error(`❌ Failed to set remote answer for ${data.user}:`, e.message);
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
            console.log(`✅ ICE candidate added for ${data.user}`);
          } else {
            peerConn._bufferedCandidates = peerConn._bufferedCandidates || [];
            peerConn._bufferedCandidates.push(data.candidate);
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
    console.error("❌ Error handling WebSocket message:", error.name, error.message, error.stack);
  }
};

async function createPeer(user) {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
  const iceServers = await fetchIceServers();
  console.log("🧊 ICE Servers used:", iceServers);
  const peer = new RTCPeerConnection({ iceServers });

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
    console.log(`🎞️ Received streams:`, event.streams.map(s => ({ id: s.id, active: s.active })));
    if (event.streams && event.streams[0]) {
      addVideoStream(event.streams[0], user);
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
      console.log(`➕ Adding local track for ${user}:`, { kind: track.kind, enabled: track.enabled, id: t.id });
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
  if (!peers[user]) await createPeer(user);
  try {
    const peer = peers[user];
    if (peer.signalingState !== "stable") {
      console.warn(`⚠️ Cannot create offer for ${user}, signaling state is ${peer.signalingState}`);
      return;
    }
    peer._flags = peer._flags || {};
    peer._flags.makingOffer = true;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(`✅ Offer created and set for ${user}. New signaling state:`, peer.signalingState);
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
  } catch (e) {
    console.error("❌ Error creating offer:", e.message, e.stack);
  } finally {
    peers[user]._flags.makingOffer = false;
  }
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  console.log(`➕ Adding video stream for ${user} with stream ID: ${stream.id}`);
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
    console.log(`🗑️ Peer connection for ${user} closed and removed.`);
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
  if (screenVideoElement) {
    const container = screenVideoElement.closest(".video-container");
    if (container) {
      container.remove();
    } else {
      screenVideoElement.remove();
    }
  }
  screenStream = null;
  screenVideoElement = null;

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
