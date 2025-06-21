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

// Don't connect immediately - wait for name to be provided
let ws = null;
let isInitialized = false;
const peers = {};
let isMakingOffer = false;
let isPolite = false;
let isSettingRemoteAnswerPending = false;
let localStream;

// Add a global state for key exchange
let allKeysExchanged = false;

function setE2EEControlsEnabled(enabled) {
  const e2eeBtn = document.getElementById("e2ee-btn");
  if (e2eeBtn) e2eeBtn.disabled = !enabled;

  const e2eeVerifyBtn = document.getElementById("e2ee-verify-btn");
  if (e2eeVerifyBtn) e2eeVerifyBtn.disabled = !enabled;

  // Show algorithm indicator when controls are enabled
  const algorithmIndicator = document.getElementById(
    "e2ee-algorithm-indicator"
  );
  if (algorithmIndicator && enabled) {
    algorithmIndicator.style.display = "inline";
  }
}

function showKeyExchangeLoading(show) {
  let loading = document.getElementById("key-exchange-loading");
  if (!loading) {
    loading = document.createElement("div");
    loading.id = "key-exchange-loading";
    loading.style.position = "fixed";
    loading.style.top = "10px";
    loading.style.left = "50%";
    loading.style.transform = "translateX(-50%)";
    loading.style.background = "#fff";
    loading.style.padding = "10px 20px";
    loading.style.borderRadius = "8px";
    loading.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    loading.style.zIndex = "2000";
    loading.style.fontWeight = "bold";
    loading.innerText = "Exchanging encryption keys...";
    document.body.appendChild(loading);
  }
  loading.style.display = show ? "block" : "none";
}

// Disable E2EE controls initially
setE2EEControlsEnabled(false);
showKeyExchangeLoading(true);

// Track expected users for key exchange
let expectedUsers = new Set();
let receivedKeys = new Set();

function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}

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

  const qrModal = document.getElementById("qr-modal");
  if (qrModal) qrModal.style.display = "none";

  // Only initialize if name is provided
  if (name) {
    if (document.getElementById("user-name-display")) {
      document.getElementById("user-name-display").textContent = name;
    }
    await testLocalStream();
    await initializeMeeting(name);
  } else {
    // Wait for name to be provided via the modal
    console.log("⏳ Waiting for user to enter name...");
  }
});

document.getElementById("qr-btn").addEventListener("click", () => {
  const meetingId = new URLSearchParams(window.location.search).get("room");
  // Only include the room parameter in the QR code - don't include the name
  // This way, users who scan the QR code will be prompted to enter their own name
  const meetingUrl = `${window.location.origin}${window.location.pathname}?room=${meetingId}`;
  const qrContainer = document.getElementById("qrcode");
  qrContainer.innerHTML = ""; // Clear old QR
  new QRCode(qrContainer, meetingUrl);
  // Set the link text for copying
  const qrLinkElem = document.getElementById("qr-link");
  if (qrLinkElem) qrLinkElem.textContent = meetingUrl;
  document.getElementById("qr-modal").style.display = "block";
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
          qrData.targetUserId &&
          qrData.code
        ) {
          // Compare scanned code with our own generated code for that user
          const isVerified = await keyVerification.verifyKey(
            qrData.targetUserId,
            qrData.code,
            qrData
          );
          updateVerificationStatus(qrData.targetUserId, isVerified);
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

async function fetchIceServers() {
  return [
    {
      urls: ["stun:fr-turn7.xirsys.com"],
    },
    {
      username:
        "huKntz4GRVlRWIWnZ6JFKuNwlF1AG1d8Obm0i_u4o6DHsvQQtgbk44G2Nh5lq9QhAAAAAGhWEJ5TRUVOR1Az",
      credential: "8a7571e8-4e42-11f0-8f74-ce0c22b1fe9d",
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

// Function to initialize the meeting connection
async function initializeMeeting(userName) {
  if (isInitialized) return;

  console.log("🔗 Connecting to signaling server at", SIGNALING_SERVER_URL);
  ws = new WebSocket(SIGNALING_SERVER_URL);

  ws.onopen = async () => {
    console.log("✅ WebSocket connected!");
    try {
      await startCamera();
      if (!localStream || !localStream.getTracks().length) {
        alert(
          "Failed to start camera/microphone. Please check permissions and try again."
        );
        return;
      }
      e2eeManager = new E2EEManager();
      const keyInfo = await e2eeManager.initialize();
      await e2eeManager.addParticipant(userName, keyInfo.publicKeyBase64);
      transformManager = new WebRTCTransformManager(e2eeManager);
      keyVerification = new KeyVerification(e2eeManager);

      // Show algorithm indicator
      const algorithmIndicator = document.getElementById(
        "e2ee-algorithm-indicator"
      );
      if (algorithmIndicator) {
        algorithmIndicator.style.display = "inline";
        algorithmIndicator.title = `Using ${keyInfo.algorithm} encryption`;
      }

      console.log("🔐 E2EE system initialized successfully");
      ws.send(
        JSON.stringify({
          type: "join",
          room,
          user: userName,
          publicKey: keyInfo.publicKeyBase64,
        })
      );
      addParticipant(userName);
      // Wait for key exchange to complete before enabling controls
      // (handled in ws.onmessage)
    } catch (error) {
      alert(
        "Failed to start camera/microphone. Please check permissions and try again."
      );
      console.error("❌ Failed to start camera before joining:", error);
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

  ws.onmessage = async (message) => {
    try {
      const data = JSON.parse(message.data);
      console.log("📩 WebSocket message received:", data);
      if (!data.type) return;
      if (data.type === "new-user" && data.user !== userName) {
        expectedUsers.add(data.user);
      }
      switch (data.type) {
        case "verification-complete":
          console.log(
            `✅ ${data.fromUser} has verified you. Establishing media.`
          );
          establishMediaWithUser(data.fromUser);
          updateVerificationStatus(data.fromUser, true);
          break;
        case "new-user":
          console.log(`✨ New user joined: ${data.user}`);

          // Don't connect to yourself
          if (data.user === userName) return;

          // Add to participant list and create a placeholder
          addParticipant(data.user);
          addUnverifiedUserPlaceholder(data.user);

          // Always handle E2EE key exchange if publicKey is present
          if (data.publicKey && e2eeManager) {
            try {
              const success = await e2eeManager.addParticipant(
                data.user,
                data.publicKey
              );
              if (success) {
                receivedKeys.add(data.user);
                if (
                  expectedUsers.size > 0 &&
                  receivedKeys.size === expectedUsers.size
                ) {
                  allKeysExchanged = true;
                  setE2EEControlsEnabled(true);
                  showKeyExchangeLoading(false);
                }
                console.log(`🔐 E2EE key exchange completed with ${data.user}`);

                // Start key rotation if this is the first participant
                if (e2eeManager.getParticipantCount() === 1) {
                  e2eeManager.startKeyRotation();
                }
              } else {
                console.error(`❌ E2EE key exchange failed with ${data.user}`);
              }
            } catch (error) {
              alert(
                `Failed to exchange encryption key with ${data.user}. Try refreshing the page.`
              );
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
          const offerPeer =
            peers[data.fromUser] || (await createPeer(data.fromUser));
          const offerCollision =
            isMakingOffer || offerPeer.signalingState !== "stable";

          isPolite = userName.localeCompare(data.fromUser) > 0;
          if (offerCollision && !isPolite) {
            console.warn(
              `⚠️ Offer collision from ${data.fromUser}, dropping offer`
            );
            return;
          }

          try {
            await offerPeer.setRemoteDescription(
              new RTCSessionDescription(data.offer)
            );
            if (offerPeer._bufferedCandidates?.length) {
              for (const candidate of offerPeer._bufferedCandidates) {
                try {
                  await offerPeer.addIceCandidate(
                    new RTCIceCandidate(candidate)
                  );
                  console.log(
                    `✅ Buffered ICE candidate added for ${data.fromUser}`
                  );
                } catch (e) {
                  console.error(`❌ Error adding buffered ICE candidate:`, e);
                }
              }
              offerPeer._bufferedCandidates = [];
            }

            console.log(`✅ Remote offer set for ${data.fromUser}`);
            const answer = await offerPeer.createAnswer();
            await offerPeer.setLocalDescription(answer);
            console.log(`✅ Answer created and set for ${data.fromUser}`);
            ws.send(
              JSON.stringify({
                type: "answer",
                answer,
                room,
                user: userName,
                toUser: data.fromUser,
              })
            );
          } catch (e) {
            console.error("❌ Failed to handle offer:", e);
          }
          break;

        case "answer":
          console.log(`📬 Answer received from ${data.user}`);
          if (peers[data.fromUser]) {
            const peer = peers[data.fromUser];
            try {
              await peer.setRemoteDescription(
                new RTCSessionDescription(data.answer)
              );
              if (peer._bufferedCandidates?.length) {
                for (const candidate of peer._bufferedCandidates) {
                  try {
                    await peer.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(
                      `✅ Buffered ICE candidate added for ${data.fromUser}`
                    );
                  } catch (e) {
                    console.error(`❌ Error adding buffered ICE candidate:`, e);
                  }
                }
                peer._bufferedCandidates = [];
              }

              console.log(
                `✅ Remote description (answer) set for ${data.fromUser}`
              );
            } catch (e) {
              console.error(
                `❌ Failed to set remote answer for ${data.fromUser}:`,
                e.message
              );
            }
          } else {
            console.warn(`⚠️ No peer connection found for ${data.fromUser}`);
          }
          break;

        case "candidate":
          const peerConn = peers[data.fromUser];
          if (peerConn) {
            if (peerConn.remoteDescription && peerConn.remoteDescription.type) {
              try {
                await peerConn.addIceCandidate(
                  new RTCIceCandidate(data.candidate)
                );
                console.log(`✅ ICE candidate added for ${data.fromUser}`);
              } catch (e) {
                console.error(
                  `❌ Error adding ICE candidate for ${data.fromUser}:`,
                  e
                );
              }
            } else {
              // Buffer candidates if remote description not set yet
              if (!peerConn._bufferedCandidates) {
                peerConn._bufferedCandidates = [];
              }
              peerConn._bufferedCandidates.push(data.candidate);
              console.log(`📦 Buffered ICE candidate for ${data.fromUser}`);
            }
          } else {
            console.warn(`⚠️ No peer connection found for ${data.fromUser}`);
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
          console.log(
            `📩 Chat message received from ${data.user}: ${data.text}`
          );
          displayMessage({
            user: data.user,
            text: data.text,
            own: data.user === userName,
          });
          break;

        case "e2ee-verification":
          if (keyVerification && data.user !== userName) {
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
      alert(
        "An error occurred while processing a message from the server. Please refresh the page."
      );
      console.error("❌ Error handling WebSocket message:", error);
    }
  };

  isInitialized = true;
}

async function startCamera() {
  console.log("🎥 Attempting to start camera and microphone...");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    // Set audio and video tracks based on isMuted and isVideoOff
    localStream.getAudioTracks().forEach((track) => (track.enabled = !isMuted));
    localStream
      .getVideoTracks()
      .forEach((track) => (track.enabled = !isVideoOff));
    // Update UI buttons to reflect the correct state
    const muteBtn = document.getElementById("mute-btn");
    const videoBtn = document.getElementById("video-btn");
    if (muteBtn) muteBtn.classList.toggle("active", isMuted);
    if (videoBtn) videoBtn.classList.toggle("active", isVideoOff);
    console.log(
      `✅ Camera and microphone accessed. Mic: ${
        !isMuted ? "ON" : "OFF"
      }, Video: ${!isVideoOff ? "ON" : "OFF"}`
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

function updateConnectionStatus(status) {
  const el = document.getElementById("connection-status");
  if (!el) return;
  el.textContent = status;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}

function showReconnectButton(show) {
  const btn = document.getElementById("reconnect-btn");
  if (!btn) return;
  btn.style.display = show ? "block" : "none";
}

// Add reconnect button logic
const reconnectBtn = document.getElementById("reconnect-btn");
if (reconnectBtn) {
  reconnectBtn.onclick = function () {
    window.location.reload();
  };
}

// Wrap RTCPeerConnection creation to add ICE state logging and user feedback
async function createPeer(user) {
  if (peers[user]) {
    console.warn(`Peer connection already exists for ${user}.`);
    return peers[user];
  }
  console.log(`🏗️ Creating new peer connection for ${user}`);

  const iceServers = await fetchIceServers();
  const pc = new RTCPeerConnection({
    iceServers: iceServers,
    sdpSemantics: "unified-plan",
  });
  peers[user] = pc;

  // Add transceivers for audio and video, but disable them initially
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTransceiver(track, {
        direction: "inactive",
        streams: [localStream],
      });
    });
    console.log(`🎤📹 Transceivers added for ${user} in 'inactive' state.`);
  }

  // Handle incoming tracks from the other user
  pc.ontrack = (event) => {
    console.log(`🛤️ Track received from ${user}:`, event.track.kind);
    addVideoStream(event.streams[0], user);
  };

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      const currentName =
        new URLSearchParams(window.location.search).get("name") || name;
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
          room,
          toUser: user,
          fromUser: currentName,
        })
      );
    }
  };

  // Log connection state changes for debugging
  pc.oniceconnectionstatechange = () => {
    console.log(
      `🧊 ICE connection state for ${user}: ${pc.iceConnectionState}`
    );
  };

  pc.onconnectionstatechange = () => {
    console.log(`🌐 Connection state for ${user}: ${pc.connectionState}`);
  };

  return pc;
}

async function createOffer(user) {
  console.log(`📤 Creating offer for ${user}`);
  const peer = peers[user];
  if (!peer) {
    console.error(`❌ No peer connection found for ${user}`);
    return;
  }

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const currentName =
      new URLSearchParams(window.location.search).get("name") || name;
    ws.send(
      JSON.stringify({
        type: "offer",
        offer,
        room,
        user: currentName,
        toUser: user,
      })
    );
    console.log(`✅ Offer sent to ${user}`);
  } catch (error) {
    console.error(`❌ Failed to create offer for ${user}:`, error);
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
    ws.send(
      JSON.stringify({
        type: "answer",
        answer,
        room,
        user: name,
        toUser: user,
      })
    );
    console.log(
      `✅ Answer created and set for ${user}. New signaling state:`,
      peer.signalingState
    );
  } catch (e) {
    console.error("❌ Error creating answer:", e.message, e.stack);
  }
}

function addVideoStream(stream, user) {
  let container = document.getElementById(`video-container-${user}`);

  // If a placeholder doesn't exist, create the container
  if (!container) {
    const videoGrid = document.getElementById("video-grid");
    container = document.createElement("div");
    container.id = `video-container-${user}`;
    container.className = "video-container";
    videoGrid.appendChild(container);
  }

  // Clear placeholder content and add video
  container.innerHTML = "";
  container.classList.remove("unverified");

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsinline = true;
  video.className = "user-video";

  const nameTag = document.createElement("p");
  nameTag.textContent = user;

  container.appendChild(video);
  container.appendChild(nameTag);
}

function removeVideoStream(user) {
  const container = document.getElementById(`video-container-${user}`);
  if (container) {
    container.remove();
  }
}

function addUnverifiedUserPlaceholder(userId) {
  if (document.getElementById(`video-container-${userId}`)) return;

  const videoGrid = document.getElementById("video-grid");
  const container = document.createElement("div");
  container.id = `video-container-${userId}`;
  container.className = "video-container unverified";

  const placeholderContent = `
    <div class="unverified-overlay">
      <i class="fas fa-user-lock"></i>
      <p class="username">${userId}</p>
      <p class="status">Pending verification</p>
    </div>
  `;
  container.innerHTML = placeholderContent;
  videoGrid.appendChild(container);
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
  if (msg) {
    const currentName =
      new URLSearchParams(window.location.search).get("name") || name;
    ws.send(
      JSON.stringify({ type: "chat", user: currentName, text: msg, room })
    );
    displayMessage({ user: currentName, text: msg, own: true });
    chatInputField.value = "";
  }
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
  if (!allKeysExchanged) {
    alert(
      "Please wait until all encryption keys are exchanged before enabling E2EE."
    );
    return;
  }
  if (!e2eeManager || !e2eeManager.isInitialized) {
    alert("E2EE system not initialized yet");
    return;
  }

  isE2EEEnabled = !isE2EEEnabled;

  const btn = document.getElementById("e2ee-btn");
  const algorithmIndicator = document.getElementById(
    "e2ee-algorithm-indicator"
  );

  if (isE2EEEnabled) {
    btn.style.backgroundColor = "#28a745"; // ✅ green
    btn.style.color = "white";
    // Show algorithm indicator when E2EE is enabled
    if (algorithmIndicator) {
      algorithmIndicator.style.display = "inline";
      algorithmIndicator.style.color = "#28a745";
    }
  } else {
    btn.style.backgroundColor = ""; // 🔁 default
    btn.style.color = "";
    // Hide algorithm indicator when E2EE is disabled
    if (algorithmIndicator) {
      algorithmIndicator.style.display = "none";
    }
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
  if (!keyVerification) {
    console.error("❌ Key verification not initialized");
    return;
  }

  try {
    const verificationCode = await keyVerification.generateVerificationCode(
      userId
    );
    const currentName =
      new URLSearchParams(window.location.search).get("name") || name;
    ws.send(
      JSON.stringify({
        type: "e2ee-verification",
        user: currentName,
        targetUser: userId,
        code: verificationCode,
        room,
      })
    );
    console.log(`🔐 Verification code sent to ${userId}`);
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

  if (ws && ws.readyState === WebSocket.OPEN) {
    const currentName =
      new URLSearchParams(window.location.search).get("name") || name;
    ws.send(JSON.stringify({ type: "leave", room, user: currentName }));
    ws.close();
  }

  window.location.href = "dashboard.html";
}

// Manual E2EE Key Verification logic
function openManualE2EEModal() {
  const modal = document.getElementById("e2ee-manual-modal");
  if (!modal) return;
  // Show modal
  modal.style.display = "flex";
  // Show user's own key
  let myKey = "";
  if (e2eeManager && e2eeManager.keyPair) {
    myKey = e2eeManager.getPublicKeyBase64();
    document.getElementById("my-e2ee-key").value = myKey;
  }
  // Populate user selection dropdown
  const userSelect = document.getElementById("e2ee-verify-user-select");
  userSelect.innerHTML = '<option value="">--Select a user--</option>'; // Clear previous options
  if (e2eeManager) {
    const participants = e2eeManager.getParticipantList();
    const currentName =
      new URLSearchParams(window.location.search).get("name") || name;
    participants.forEach((user) => {
      if (user !== currentName) {
        const option = document.createElement("option");
        option.value = user;
        option.textContent = user;
        userSelect.appendChild(option);
      }
    });
  }
  // Clear previous result and input
  document.getElementById("e2ee-verify-result").textContent = "";
  document.getElementById("other-e2ee-key").value = "";
}

function closeManualE2EEModal() {
  const modal = document.getElementById("e2ee-manual-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

document
  .getElementById("e2ee-verify-btn")
  .addEventListener("click", openManualE2EEModal);

document
  .getElementById("copy-my-e2ee-key")
  .addEventListener("click", function () {
    const key = document.getElementById("my-e2ee-key").value;
    if (key) {
      navigator.clipboard.writeText(key);
      this.textContent = "Copied!";
      setTimeout(() => (this.textContent = "Copy"), 1200);
    }
  });

document
  .getElementById("verify-e2ee-key-btn")
  .addEventListener("click", function () {
    const selectedUser = document.getElementById(
      "e2ee-verify-user-select"
    ).value;
    const otherKey = document.getElementById("other-e2ee-key").value.trim();
    const resultDiv = document.getElementById("e2ee-verify-result");

    if (!selectedUser) {
      resultDiv.textContent = "Please select a user to verify.";
      resultDiv.style.color = "#ffc107";
      return;
    }

    if (!otherKey) {
      resultDiv.textContent = "Please enter the other user's key.";
      resultDiv.style.color = "#ffc107";
      return;
    }

    const storedKeyForUser = e2eeManager.getParticipantPublicKey(selectedUser);

    if (!storedKeyForUser) {
      resultDiv.textContent = "Could not find a stored key for this user.";
      resultDiv.style.color = "#ff4d4d";
      return;
    }

    if (storedKeyForUser === otherKey) {
      resultDiv.textContent = "✅ Keys Match! The connection is secure.";
      resultDiv.style.color = "#4caf50";
      // Mark user as verified and establish media flow
      updateVerificationStatus(selectedUser, true);
      establishMediaWithUser(selectedUser);
      // Notify the other user that they have been verified
      const currentName =
        new URLSearchParams(window.location.search).get("name") || name;
      ws.send(
        JSON.stringify({
          type: "verification-complete",
          fromUser: currentName,
          toUser: selectedUser,
        })
      );
    } else {
      resultDiv.textContent =
        "❌ Keys Do NOT Match! Connection may not be secure.";
      resultDiv.style.color = "#ff4d4d";
      updateVerificationStatus(selectedUser, false);
    }
  });

async function establishMediaWithUser(userId) {
  const pc = peers[userId];
  if (!pc) {
    console.error(`Cannot establish media, no peer connection for ${userId}`);
    return;
  }

  console.log(`🚀 Establishing media with ${userId}...`);
  // Set transceivers to send and receive
  pc.getTransceivers().forEach((transceiver) => {
    transceiver.direction = "sendrecv";
  });
}
