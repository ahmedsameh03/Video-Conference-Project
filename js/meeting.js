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
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production-65d5.up.railway.app";

const ws = new WebSocket(SIGNALING_SERVER_URL);

const peers = {};
let isMakingOffer = false;
let isPolite = false;
let localStream;

async function testLocalStream() {
  try {
    const testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = testStream;
    localVideo.muted = true;
    await localVideo.play().catch(e => console.error(e));
    testStream.getTracks().forEach(track => track.stop());
  } catch (error) {
    console.error(error.name, error.message);
    alert(`Test Stream failed: ${error.name} - ${error.message}. Please check camera/microphone permissions.`);
  }
}

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
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302"
      ]
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
  try {
    await startCamera();
    if (!localStream || !localStream.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available.");
    }
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name);
  } catch (error) {
    console.error(error);
    alert("Failed to start camera/microphone. Please check permissions and try again.");
  }
};

ws.onerror = (error) => {
  console.error(error);
  alert("WebSocket connection error. Please check the server and your connection.");
};

ws.onclose = (event) => {
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
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (error) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (error2) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (error3) {
        console.error(error3.name, error3.message);
        throw new Error("Failed to access camera or microphone after all attempts.");
      }
    }
  }

  if (!localStream.getTracks().length) {
    throw new Error("No tracks (video or audio) available.");
  }
  localVideo.srcObject = localStream;
  localVideo.muted = true;
  await localVideo.play().catch(e => console.error(e));
}

ws.onmessage = async (message) => {
  try {
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
        const peer = peers[data.user] || await createPeer(data.user);
        const offerCollision = isMakingOffer || peer.signalingState !== "stable";
        isPolite = name.localeCompare(data.user) > 0;
        if (offerCollision && !isPolite) {
          return;
        }
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
          if (peer._bufferedCandidates?.length) {
            for (const candidate of peer._bufferedCandidates) {
              try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error(e);
              }
            }
            peer._bufferedCandidates = [];
          }
          const answer = await peer.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await peer.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
        } catch (e) {
          console.error(e);
        }
        break;

      case "answer":
        if (peers[data.user]) {
          const peer = peers[data.user];
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
            if (peer._bufferedCandidates?.length) {
              for (const candidate of peer._bufferedCandidates) {
                try {
                  await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                  console.error(e);
                }
              }
              peer._bufferedCandidates = [];
            }
          } catch (e) {
            console.error(e.message);
          }
        }
        break;

      case "candidate":
        const peerConn = peers[data.user];
        if (peerConn) {
          if (peerConn.remoteDescription?.type) {
            try {
              await peerConn.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
              console.error(e);
            }
          } else {
            peerConn._bufferedCandidates = peerConn._bufferedCandidates || [];
            peerConn._bufferedCandidates.push(data.candidate);
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
  } catch (error) {
    console.error(error.name, error.message);
  }
};

async function createPeer(user) {
  const iceServers = await fetchIceServers();
  const peer = new RTCPeerConnection({
    iceServers: iceServers
  });

  peer.oniceconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(peer.iceConnectionState)) {
      if (peer.iceConnectionState === "failed") {
        peer.restartIce();
      }
    }
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed") {
      createPeer(user).then(() => createOffer(user));
    }
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user }));
      }, 200);
    }
  };

  peer.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      addVideoStream(event.streams[0], user);
    }
  };

  if (localStream && localStream.getTracks().length) {
    localStream.getTracks().forEach(track => {
      if (!track.enabled) {
        track.enabled = true;
      }
      peer.addTrack(track, localStream);
    });
  } else {
    await startCamera();
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }

  peers[user] = peer;
  return peer;
}

async function createOffer(user) {
  if (!peers[user]) await createPeer(user);
  try {
    peers[user]._flags = peers[user]._flags || {};
    peers[user]._flags.makingOffer = true;
    const peer = peers[user];
    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peer.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
  } catch (e) {
    console.error(e.message);
  } finally {
    peers[user]._flags.makingOffer = false;
  }
}

async function createAnswer(offer, user) {
  if (!peers[user]) await createPeer(user);
  try {
    const peer = peers[user];
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peer.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
  } catch (e) {
    console.error(e.message);
  }
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
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

let screenStream, screenVideoElement;

async function shareScreen() {
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
        }
      }
    });

    screenStream.getVideoTracks()[0].onended = () => {
      stopScreenShare();
    };
  } catch (error) {
    console.error(error);
    alert(`Error sharing screen: ${error.name} - ${error.message}`);
  }
}

function stopScreenShare() {
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
  ws.send(JSON.stringify({ type: "chat", user: name, text: msg, room }));
  displayMessage({ user: name, text: msg, own: true });
  chatInputField.value = "";
}

function displayMessage({ user, text, own }) {
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
  localStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(p => p.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}
