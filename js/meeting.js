const queryParams = getQueryParams();
const room = queryParams.room;
const name = queryParams.name;
let isMuted = false;
let isVideoOff = false;
let e2eeManager;
let transformManager;
let keyVerification;
let isE2EEEnabled = false;
const localVideo = document.getElementById("large-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");

const SIGNALING_SERVER_URL =
  "wss://video-conference-project-production.up.railway.app";

console.log("🔗 Connecting to signaling server at", SIGNALING_SERVER_URL);
const ws = new WebSocket(SIGNALING_SERVER_URL);

const peers = {};
let isMakingOffer = false;
let isPolite = false;
let isSettingRemoteAnswerPending = false;
let localStream;

// اختبار بسيط للـ Local Stream
async function testLocalStream() {
  console.log("🧪 Testing local camera and microphone...");
  try {
    const testStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    console.log(
      "✅ Test Stream successful! Tracks:",
      testStream
        .getTracks()
        .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
    );
    localVideo.srcObject = testStream;
    localVideo.style.transform = "scaleX(-1)";
    localVideo.muted = true;
    await localVideo
      .play()
      .catch((e) => console.error("❌ Test Video play failed:", e));
    testStream.getTracks().forEach((track) => track.stop());
    console.log("🧪 Test completed. Local camera and microphone are working.");
  } catch (error) {
    console.error(
      "❌ Test Stream failed:",
      error.name,
      error.message,
      error.stack
    );
    alert(
      `Test Stream failed: ${error.name} - ${error.message}. Please check camera/microphone permissions and ensure they are not blocked.`
    );
  }
}

// تشغيل الاختبار البسيط عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("meeting-id-display")) {
    document.getElementById("meeting-id-display").textContent = `#${room}`;
  }
  if (document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent = name;
  }
  await testLocalStream();
});

document.getElementById("qr-btn").addEventListener("click", () => {
  const meetingId = new URLSearchParams(window.location.search).get("room");
  const meetingUrl = `${window.location.origin}${window.location.pathname}?room=${meetingId}`;
  const qrContainer = document.getElementById("qrcode");
  qrContainer.innerHTML = ""; // Clear old QR
  new QRCode(qrContainer, meetingUrl);
  document.getElementById("qr-modal").style.display = "block";
});

// E2EE Key verification QR code
document
  .getElementById("e2ee-verify-btn")
  .addEventListener("click", async () => {
    if (!keyVerification) {
      alert("E2EE not initialized yet");
      return;
    }

    try {
      const qrData = await keyVerification.generateQRData(name);
      const qrContainer = document.getElementById("e2ee-qrcode");
      qrContainer.innerHTML = ""; // Clear old QR
      new QRCode(qrContainer, qrData);
      document.getElementById("e2ee-verify-modal").style.display = "block";
    } catch (error) {
      console.error("❌ Failed to generate E2EE verification QR:", error);
      alert("Failed to generate verification QR code");
    }
  });

// QR Scanner logic
let html5QrCodeInstance = null;

function openE2EEScanModal() {
  document.getElementById("e2ee-scan-modal").style.display = "block";
  if (!window.Html5Qrcode) {
    alert("QR code scanner library not loaded!");
    return;
  }
  if (!html5QrCodeInstance) {
    html5QrCodeInstance = new Html5Qrcode("e2ee-qr-scanner");
  }
  html5QrCodeInstance.start(
    { facingMode: "environment" },
    {
      fps: 10,
      qrbox: 250,
    },
    async (decodedText, decodedResult) => {
      try {
        const qrData = JSON.parse(decodedText);
        if (
          qrData.type === "e2ee-verification" &&
          qrData.userId &&
          qrData.code
        ) {
          // Compare scanned code with our own generated code for that user
          const isVerified = await keyVerification.verifyKey(
            qrData.userId,
            qrData.code
          );
          updateVerificationStatus(qrData.userId, isVerified);
          alert(
            isVerified
              ? `✅ Keys match for ${qrData.userId}!`
              : `❌ Keys do NOT match for ${qrData.userId}!`
          );
          closeE2EEScanModal();
        } else {
          alert("Invalid E2EE QR code format.");
        }
      } catch (e) {
        alert("Failed to parse QR code.");
      }
    },
    (errorMessage) => {
      // Ignore scan errors
    }
  );
}

function closeE2EEScanModal() {
  document.getElementById("e2ee-scan-modal").style.display = "none";
  if (html5QrCodeInstance) {
    html5QrCodeInstance.stop().then(() => {
      html5QrCodeInstance.clear();
    });
  }
}

document
  .getElementById("e2ee-scan-btn")
  .addEventListener("click", openE2EEScanModal);

async function fetchIceServers() {
  return [
    {
      urls: ["stun:fr-turn7.xirsys.com"],
    },
    {
      username:
        "L2a-fvFXKem5bHUHPf_WEX4oi-Ixl0BHHXuz4z_7KSgyjpfxuzhcVM2Tu_DfwOTUAAAAAGgpFR1haG1lZHNhbWVoMDM=",
      credential: "c3c10bb4-3372-11f0-a269-fadfa0afc433",
      urls: [
        "turn:fr-turn7.xirsys.com:80?transport=udp",
        "turn:fr-turn7.xirsys.com:3478?transport=udp",
        "turn:fr-turn7.xirsys.com:80?transport=tcp",
        "turn:fr-turn7.xirsys.com:3478?transport=tcp",
        "turns:fr-turn7.xirsys.com:443?transport=tcp",
        "turns:fr-turn7.xirsys.com:5349?transport=tcp",
      ],
    },
  ];
}

ws.onopen = async () => {
  console.log("✅ WebSocket connected!");
  try {
    await startCamera();
    if (!localStream || !localStream.getTracks().length) {
      throw new Error("Local stream not initialized or no tracks available.");
    }

    // Initialize E2EE system
    e2eeManager = new E2EEManager();
    const keyInfo = await e2eeManager.initialize();
    await e2eeManager.addParticipant(name, keyInfo.publicKeyBase64);
    transformManager = new WebRTCTransformManager(e2eeManager);
    keyVerification = new KeyVerification(e2eeManager);

    console.log("🔐 E2EE system initialized successfully");

    console.log(
      "📹 Local Stream initialized with tracks:",
      localStream
        .getTracks()
        .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
    );

    // Send join message with public key
    ws.send(
      JSON.stringify({
        type: "join",
        room,
        user: name,
        publicKey: keyInfo.publicKeyBase64,
      })
    );
    addParticipant(name);
  } catch (error) {
    console.error("❌ Failed to start camera before joining:", error);
    alert(
      "Failed to start camera/microphone. Please check permissions and try again."
    );
  }
};

ws.onerror = (error) => {
  console.error("❌ WebSocket Error:", error);
  alert(
    "WebSocket connection error. Please check the server and your connection."
  );
};

ws.onclose = (event) => {
  console.log("🔌 WebSocket connection closed:", event.code, event.reason);
  if (!event.wasClean) {
    alert(
      "WebSocket connection closed unexpectedly. Please try refreshing the page."
    );
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
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    console.log(
      "✅ Attempt 1: Both camera and microphone accessed successfully."
    );
  } catch (error) {
    console.warn("⚠️ Attempt 1 failed:", error.name, error.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      console.log("✅ Attempt 2: Camera only accessed successfully.");
    } catch (error2) {
      console.warn("⚠️ Attempt 2 failed:", error2.name, error2.message);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });
        console.log("✅ Attempt 3: Microphone only accessed successfully.");
      } catch (error3) {
        console.error(
          "❌ All attempts failed:",
          error3.name,
          error3.message,
          error3.stack
        );
        throw new Error(
          "Failed to access camera or microphone after all attempts."
        );
      }
    }
  }

  if (!localStream.getTracks().length) {
    throw new Error("No tracks (video or audio) available.");
  }
  console.log(
    "✅ Final Stream Tracks:",
    localStream
      .getTracks()
      .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
  );
  localVideo.srcObject = localStream;
  localVideo.muted = true;
  await localVideo
    .play()
    .catch((e) => console.error("❌ Video play failed:", e));
}

ws.onmessage = async (message) => {
  try {
    const data = JSON.parse(message.data);
    console.log("📩 WebSocket message received:", data);
    if (!data.type) return;

    switch (data.type) {
      case "new-user":
        console.log(`✨ New user joined: ${data.user}`);

        // Don't connect to yourself
        if (data.user === name) return;

        // Add to participant list
        addParticipant(data.user);

        // Always handle E2EE key exchange if publicKey is present
        if (data.publicKey && e2eeManager) {
          try {
            const success = await e2eeManager.addParticipant(
              data.user,
              data.publicKey
            );
            if (success) {
              console.log(`🔐 E2EE key exchange completed with ${data.user}`);

              // Start key rotation if this is the first participant
              if (e2eeManager.getParticipantCount() === 1) {
                e2eeManager.startKeyRotation();
              }
            } else {
              console.error(`❌ E2EE key exchange failed with ${data.user}`);
            }
          } catch (error) {
            console.error(
              `❌ E2EE key exchange error with ${data.user}:`,
              error
            );
          }
        }

        // If not already connected, create a peer and send an offer
        if (!peers[data.user]) {
          await createPeer(data.user);
          await createOffer(data.user);
        }
        break;

      case "offer":
        console.log(`📨 Offer received from ${data.user}`);
        const peer = peers[data.user] || (await createPeer(data.user));
        const offerCollision =
          isMakingOffer || peer.signalingState !== "stable";

        isPolite = name.localeCompare(data.user) > 0;
        if (offerCollision && !isPolite) {
          console.warn(`⚠️ Offer collision from ${data.user}, dropping offer`);
          return;
        }

        try {
          await peer.setRemoteDescription(
            new RTCSessionDescription(data.offer)
          );
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
            await peer.setRemoteDescription(
              new RTCSessionDescription(data.answer)
            );
            if (peer._bufferedCandidates?.length) {
              for (const candidate of peer._bufferedCandidates) {
                try {
                  await peer.addIceCandidate(new RTCIceCandidate(candidate));
                  console.log(
                    `✅ Buffered ICE candidate added for ${data.user}`
                  );
                } catch (e) {
                  console.error(`❌ Error adding buffered ICE candidate:`, e);
                }
              }
              peer._bufferedCandidates = [];
            }

            console.log(`✅ Remote description (answer) set for ${data.user}`);
          } catch (e) {
            console.error(
              `❌ Failed to set remote answer for ${data.user}:`,
              e.message
            );
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
          } else {
            peerConn._bufferedCandidates = peerConn._bufferedCandidates || [];
            peerConn._bufferedCandidates.push(data.candidate);
          }
        }
        break;

      case "user-left":
        console.log(`🚪 User left: ${data.user}`);
        removeVideoStream(data.user);
        removeParticipant(data.user);

        // Handle E2EE cleanup
        if (e2eeManager) {
          await e2eeManager.removeParticipant(data.user);
          if (transformManager) {
            transformManager.removeTransform(peers[data.user], data.user);
          }
          if (keyVerification) {
            keyVerification.clearVerification(data.user);
          }
        }
        break;

      case "chat":
        console.log(`📩 Chat message received from ${data.user}: ${data.text}`);
        displayMessage({
          user: data.user,
          text: data.text,
          own: data.user === name,
        });
        break;

      case "e2ee-verification":
        if (keyVerification && data.user !== name) {
          try {
            const isVerified = await keyVerification.verifyKey(
              data.user,
              data.code
            );
            if (isVerified) {
              console.log(`🔐 Key verification successful with ${data.user}`);
              // Update UI to show verified status
              updateVerificationStatus(data.user, true);
            } else {
              console.warn(`⚠️ Key verification failed with ${data.user}`);
              updateVerificationStatus(data.user, false);
            }
          } catch (error) {
            console.error(
              `❌ Key verification error with ${data.user}:`,
              error
            );
          }
        }
        break;

      default:
        console.warn(`❓ Unknown message type: ${data.type}`);
    }
  } catch (error) {
    console.error(
      "❌ Error handling WebSocket message:",
      error.name,
      error.message,
      error.stack
    );
  }
};

async function createPeer(user) {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
  const iceServers = await fetchIceServers();
  console.log("🧊 ICE Servers used:", iceServers);
  const peer = new RTCPeerConnection({
    iceServers: iceServers,
  });

  peer.oniceconnectionstatechange = () => {
    console.log(`🔌 ICE state for ${user}:`, peer.iceConnectionState);
    if (
      ["failed", "disconnected", "closed"].includes(peer.iceConnectionState)
    ) {
      console.error(
        `❌ ICE connection for ${user} failed/disconnected. State: ${peer.iceConnectionState}`
      );
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
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
          room,
          user,
        })
      );
    } else {
      console.log(`🏁 All ICE candidates sent for ${user}`);
    }
  };

  peer.onicegatheringstatechange = () => {
    console.log(`🧊 ICE gathering state for ${user}:`, peer.iceGatheringState);
  };

  peer.ontrack = (event) => {
    console.log(`🎞️ Track event for ${user}:`, event);
    console.log(
      `🎞️ Received streams:`,
      event.streams.map((s) => ({ id: s.id, active: s.active }))
    );
    if (event.streams && event.streams[0]) {
      addVideoStream(event.streams[0], user);
    } else {
      console.warn(
        `⚠️ No streams received from ${user}. Check if tracks are sent.`
      );
    }
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      console.log(`➕ Adding local track for ${user}:`, {
        kind: track.kind,
        enabled: track.enabled,
        id: track.id,
      });
      if (track.enabled) {
        const sender = peer.addTrack(track, localStream);
        console.log(`✅ Added ${track.kind} track with sender:`, sender);
      } else {
        console.warn(
          `⚠️ Track ${track.kind} is disabled for ${user}. Enabling it...`
        );
        track.enabled = true;
        const sender = peer.addTrack(track, localStream);
        console.log(
          `✅ Forced enabled and added ${track.kind} track with sender:`,
          sender
        );
      }
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
    peers[user]._flags = peers[user]._flags || {};
    peers[user]._flags.makingOffer = true;
    const peer = peers[user];
    console.log(
      `🔍 Signaling state before creating offer for ${user}:`,
      peer.signalingState
    );
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(
      `✅ Offer created and set for ${user}. New signaling state:`,
      peer.signalingState
    );
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name }));
  } catch (e) {
    console.error("❌ Error creating offer:", e.message, e.stack);
  } finally {
    peers[user]._flags.makingOffer = false;
  }
}

async function createAnswer(offer, user) {
  console.log(`📬 Creating answer for ${user}`);
  if (!peers[user]) await createPeer(user);
  try {
    const peer = peers[user];
    console.log(
      `🔍 Signaling state before setting offer for ${user}:`,
      peer.signalingState
    );
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    console.log(
      `✅ Remote offer set for ${user}. New signaling state:`,
      peer.signalingState
    );
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    console.log(
      `✅ Answer created and set for ${user}. New signaling state:`,
      peer.signalingState
    );
    ws.send(JSON.stringify({ type: "answer", answer, room, user: name }));
  } catch (e) {
    console.error("❌ Error creating answer:", e.message, e.stack);
  }
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  console.log(
    `➕ Adding video stream for ${user} with stream ID: ${stream.id}`
  );
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
  const container = document.querySelector(
    `div[data-user-container="${user}"]`
  );
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
    document
      .getElementById("video-btn")
      ?.classList.toggle("active", isVideoOff);
  }
}

let screenStream, screenVideoElement;

async function shareScreen() {
  console.log("🖥️ Attempting to share screen...");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    screenVideoElement = document.createElement("video");
    screenVideoElement.srcObject = screenStream;
    screenVideoElement.autoplay = true;
    screenVideoElement.id = "screen-share";

    // Styling for reasonable size in the middle
    screenVideoElement.style.width = "70%";
    screenVideoElement.style.height = "70%";
    screenVideoElement.style.position = "fixed";
    screenVideoElement.style.top = "50%";
    screenVideoElement.style.left = "50%";
    screenVideoElement.style.transform = "translate(-50%, -50%)";
    screenVideoElement.style.border = "3px solid #4caf50";
    screenVideoElement.style.boxShadow = "0 0 20px rgba(0,0,0,0.3)";
    screenVideoElement.style.zIndex = "999";

    document.body.appendChild(screenVideoElement); // Append to body directly

    // ✅ Make sure each peer is a valid RTCPeerConnection
    Object.entries(peers).forEach(([user, peer]) => {
      if (peer instanceof RTCPeerConnection) {
        const sender = peer.getSenders().find((s) => s.track?.kind === "video");
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
    alert(`Error sharing screen: ${error.name} - ${error.message}`);
  }
}

function stopScreenShare() {
  console.log("🛑 Stopping screen share...");

  // Stop all tracks from screen stream
  screenStream?.getTracks().forEach((t) => t.stop());

  // Remove screen share video element and its container if present
  if (screenVideoElement) {
    const container = screenVideoElement.closest(".video-container");
    if (container) {
      container.remove(); // ✅ removes the black box
    } else {
      screenVideoElement.remove(); // fallback in case no container
    }
  }

  screenStream = null;
  screenVideoElement = null;

  // Revert to local camera
  const cameraTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach((peer) => {
    if (peer instanceof RTCPeerConnection) {
      const sender = peer.getSenders().find((s) => s.track?.kind === "video");
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
window.toggleE2EE = async function () {
  if (!e2eeManager || !e2eeManager.isInitialized) {
    alert("E2EE system not initialized yet");
    return;
  }

  isE2EEEnabled = !isE2EEEnabled;

  const btn = document.getElementById("e2ee-btn");
  if (isE2EEEnabled) {
    btn.style.backgroundColor = "#28a745"; // ✅ green
    btn.style.color = "white";
  } else {
    btn.style.backgroundColor = ""; // 🔁 default
    btn.style.color = "";
  }

  console.log(
    `🔐 End-to-End Encryption ${isE2EEEnabled ? "enabled" : "disabled"}`
  );

  // Apply E2EE to all peer connections
  for (const [userId, peer] of Object.entries(peers)) {
    if (
      peer instanceof RTCPeerConnection &&
      e2eeManager.isParticipant(userId)
    ) {
      if (isE2EEEnabled) {
        await transformManager.applyE2EEToPeer(peer, userId);
      } else {
        transformManager.removeTransform(peer, userId);
      }
    }
  }
};

// Function to update verification status in UI
function updateVerificationStatus(userId, isVerified) {
  const participantElement = document.getElementById(`participant-${userId}`);
  if (participantElement) {
    if (isVerified) {
      participantElement.innerHTML = `${userId} <span style="color: green;">🔐</span>`;
    } else {
      participantElement.innerHTML = `${userId} <span style="color: red;">⚠️</span>`;
    }
  }
}

// Function to send verification code to other participants
async function sendVerificationCode(userId) {
  if (!keyVerification) return;

  try {
    const verification = await keyVerification.generateVerificationCode(userId);
    ws.send(
      JSON.stringify({
        type: "e2ee-verification",
        user: name,
        targetUser: userId,
        code: verification.code,
        room,
      })
    );
  } catch (error) {
    console.error(`❌ Failed to send verification code to ${userId}:`, error);
  }
}

function leaveMeeting() {
  if (!confirm("Are you sure you want to leave the meeting?")) return;
  console.log("🚪 Leaving meeting...");

  // Clean up E2EE resources
  if (e2eeManager) {
    e2eeManager.destroy();
  }
  if (transformManager) {
    transformManager.destroy();
  }
  if (keyVerification) {
    keyVerification.clearAllVerifications();
  }

  localStream?.getTracks().forEach((t) => t.stop());
  Object.values(peers).forEach((p) => p.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}
