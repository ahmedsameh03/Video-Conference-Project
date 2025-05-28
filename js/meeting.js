// meeting.js

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
let localStream;

document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("meeting-id-display"))
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  if (document.getElementById("user-name-display"))
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
    if (localStream.getVideoTracks().length > 0) {
      addVideoStream(localStream, name); // 👈 Add self to video grid only if has video
    }
  } catch (error) {
    alert("Camera or microphone access failed.");
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
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e1) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e2) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (e3) {
        throw new Error("No camera or mic available.");
      }
    }
  }
}

ws.onmessage = async (message) => {
  const data = JSON.parse(message.data);
  if (!data.type) return;

  switch (data.type) {
    case "new-user":
      if (data.user === name) return;
      addParticipant(data.user);
      if (!peers[data.user]) {
        await createPeer(data.user);
        await createOffer(data.user);
      }
      break;

    case "offer":
      const peerOffer = peers[data.user] || await createPeer(data.user);
      await peerOffer.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushBufferedCandidates(peerOffer, data.user);
      const answer = await peerOffer.createAnswer();
      await peerOffer.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
      break;

    case "answer":
      if (peers[data.user]) {
        await peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushBufferedCandidates(peers[data.user], data.user);
      }
      break;

    case "candidate":
      const pc = peers[data.user];
      if (pc) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {
            console.warn("❌ Error adding ICE:", e.message);
          });
        } else {
          pc._bufferedCandidates = pc._bufferedCandidates || [];
          pc._bufferedCandidates.push(data.candidate);
        }
      }
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

async function flushBufferedCandidates(peer, user) {
  if (peer._bufferedCandidates?.length) {
    for (const candidate of peer._bufferedCandidates) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error(`❌ Error adding ICE for ${user}:`, e.message);
      }
    }
    peer._bufferedCandidates = [];
  }
}

async function createPeer(user) {
  const peer = new RTCPeerConnection({ iceServers: await fetchIceServers() });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user }));
    }
  };

  peer.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      if (event.streams[0].getVideoTracks().length > 0)
        addVideoStream(event.streams[0], user);
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }

  peers[user] = peer;
  return peer;
}

async function createOffer(user) {
  const peer = peers[user];
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  if (stream.getVideoTracks().length === 0) return; // Don't show black box

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
  if (audioTracks.length) {
    isMuted = !isMuted;
    audioTracks[0].enabled = !isMuted;
    document.getElementById("mute-btn")?.classList.toggle("active", isMuted);
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length) {
    isVideoOff = !isVideoOff;
    videoTracks[0].enabled = !isVideoOff;
    document.getElementById("video-btn")?.classList.toggle("active", isVideoOff);
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
