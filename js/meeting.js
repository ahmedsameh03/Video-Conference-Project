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

// Function to open the manual E2EE verification modal
async function openManualE2EEVerifyModal() {
  const manualVerifyModal = document.getElementById("manual-e2ee-verify-modal");
  const yourKeyInput = document.getElementById("your-encryption-key");
  const otherUserKeyInput = document.getElementById("other-user-encryption-key");
  const verifyManualBtn = document.getElementById("verify-manual-btn");
  const manualVerifyStatus = document.getElementById("manual-verify-status");
  const participants = Array.from(e2eeManager.participants);

  // For simplicity, this manual verification will compare with the first other participant
  // In a real app, you'd have a dropdown to select which participant to verify with
  const otherParticipantId = participants.find(p => p !== name);

  if (!otherParticipantId) {
    alert("No other participants to verify with.");
    return;
  }

  try {
    // Generate YOUR display code for the other participant
    const yourDisplayCode = await keyVerification.generateDisplayCode(otherParticipantId);
    yourKeyInput.value = yourDisplayCode;
    yourKeyInput.dataset.peerId = otherParticipantId; // Store peerId for later use

    // Clear previous input and status
    otherUserKeyInput.value = '';
    manualVerifyStatus.textContent = '';
    manualVerifyStatus.className = '';

    manualVerifyModal.style.display = 'block';

    // Event listener for manual verification button
    verifyManualBtn.onclick = async () => {
      const receivedCode = otherUserKeyInput.value.trim().toUpperCase();
      const targetPeerId = yourKeyInput.dataset.peerId; // Get the peerId from the stored data

      if (!receivedCode) {
        manualVerifyStatus.textContent = 'Please enter the other user\'s key.';
        manualVerifyStatus.className = 'text-warning';
        return;
      }

      // Verify the received code against the expected display code
      // Note: This manual verification is less secure than QR as it lacks timestamp/origin validation
      const expectedCode = await keyVerification.generateDisplayCode(targetPeerId);

      if (receivedCode === expectedCode) {
        manualVerifyStatus.textContent = '✅ Keys Match!';
        manualVerifyStatus.className = 'text-success';
        keyVerification.verificationStatus.set(targetPeerId, { verified: true, method: 'manual' });
        updateVerificationStatus(targetPeerId, true);
      } else {
        manualVerifyStatus.textContent = '❌ Keys Do NOT Match!';
        manualVerifyStatus.className = 'text-danger';
        keyVerification.verificationStatus.set(targetPeerId, { verified: false, method: 'manual' });
        updateVerificationStatus(targetPeerId, false);
      }
    };

  } catch (error) {
    console.error("❌ Failed to open manual E2EE verify modal:", error);
    alert("Failed to open manual verification. Ensure E2EE is initialized.");
  }
}

// Function to close the manual E2EE verification modal
function closeManualE2EEVerifyModal() {
  document.getElementById("manual-e2ee-verify-modal").style.display = "none";
}

async function fetchIceServers() {
  return [
    {
      urls: ["stun:fr-turn7.xirsys.com"],
    },
    {
      username:
        "gPAqemLEOWxxp3-WgI6iUrP4XG6B3V6QYpm7GM4pugLTs9v2Gz2cw03PK3v5xg0DAAAAAGhUpihTRUVOR1Ay",
      credential: "7f72ada2-4d6a-11f0-8cd8-6aee953622e2",
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
        algorithmIndicator.textContent = keyInfo.algorithm;
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
        case "new-user":
          console.log(`✨ New user joined: ${data.user}`);

          // Don't connect to yourself
          if (data.user === userName) return;

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
            console.warn(
              `⚠️ Peer connection not found for ${data.fromUser}. Buffering candidate.`
            );
            // This case should ideally not happen if new-user/offer/answer flow is correct
            // But if it does, we need to buffer the candidate until the peer connection is created
            if (!peers[data.fromUser]) {
              peers[data.fromUser] = {}; // Create a placeholder
            }
            if (!peers[data.fromUser]._bufferedCandidates) {
              peers[data.fromUser]._bufferedCandidates = [];
            }
            peers[data.fromUser]._bufferedCandidates.push(data.candidate);
          }
          break;

        case "chat":
          addChatMessage(data.user, data.text);
          break;

        case "user-left":
          console.log(`🔴 User left: ${data.user}`);
          removeParticipant(data.user);
          if (peers[data.user]) {
            peers[data.user].close();
            delete peers[data.user];
          }
          e2eeManager.removeParticipant(data.user);
          keyVerification.clearVerification(data.user);
          break;

        case "e2ee-verification":
          // This message is for QR code verification, handled by keyVerification.verifyQRData
          // The actual verification logic is in key-verification.js
          break;

        default:
          console.warn("⚠️ Unknown message type:", data.type);
          break;
      }
    } catch (error) {
      console.error("❌ Error processing WebSocket message:", error);
    }
  };
}

async function startCamera() {
  console.log("🎥 Attempting to start camera and microphone...");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    console.log("✅ Camera and microphone accessed. Mic: ON, Video: ON");

    // Display local stream in the large video element
    localVideo.srcObject = localStream;
    localVideo.style.transform = "scaleX(-1)"; // Mirror effect for local video
    localVideo.muted = true; // Mute local audio to prevent echo
    await localVideo.play().catch((e) => console.error("❌ Local video play failed:", e));

    console.log(
      "✅ Final Stream Tracks:",
      localStream
        .getTracks()
        .map((t) => ({ kind: t.kind, enabled: t.enabled, id: t.id }))
    );
  } catch (error) {
    console.error("❌ Error accessing camera/microphone:", error);
    alert(
      "Could not access camera or microphone. Please check permissions and ensure no other application is using them."
    );
    throw error; // Re-throw to stop initialization if camera fails
  }
}

async function createPeer(userId) {
  console.log("🤝 Creating RTCPeerConnection for user:", userId);
  const iceServers = await fetchIceServers();
  console.log("🧊 ICE Servers used:", iceServers);

  const peer = new RTCPeerConnection({
    iceServers: iceServers,
  });
  peers[userId] = peer;

  // Add local stream tracks to the peer connection
  localStream.getTracks().forEach((track) => {
    console.log(`➕ Adding local track for ${userId}:`, track);
    peer.addTrack(track, localStream);
  });

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) {
      console.log("🧊 Sending ICE candidate to", userId, ":", candidate);
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate,
          room,
          user: name,
          toUser: userId,
        })
      );
    }
  };

  peer.onicegatheringstatechange = () => {
    console.log("🧊 ICE gathering state for", userId, ":", peer.iceGatheringState);
  };

  peer.oniceconnectionstatechange = () => {
    console.log("🔗 ICE connection state for", userId, ":", peer.iceConnectionState);
    if (peer.iceConnectionState === "failed") {
      peer.restartIce();
    }
  };

  peer.onsignalingstatechange = () => {
    console.log("🚦 Signaling state for", userId, ":", peer.signalingState);
  };

  peer.ontrack = (event) => {
    console.log("🎧 Remote track received from", userId, ":", event.track);
    const remoteStream = event.streams[0];
    const videoElement = document.getElementById(`video-${userId}`);

    if (videoElement) {
      videoElement.srcObject = remoteStream;
      videoElement.play().catch((e) => console.error("❌ Remote video play failed:", e));
    } else {
      // Create new video element for the remote stream
      const newVideoContainer = document.createElement("div");
      newVideoContainer.id = `container-${userId}`;
      newVideoContainer.classList.add("video-container");

      const newVideo = document.createElement("video");
      newVideo.id = `video-${userId}`;
      newVideo.autoplay = true;
      newVideo.playsInline = true;
      newVideo.srcObject = remoteStream;
      newVideo.style.transform = "scaleX(-1)"; // Mirror effect for remote video
      newVideo.play().catch((e) => console.error("❌ Remote video play failed:", e));

      const userNameDisplay = document.createElement("p");
      userNameDisplay.textContent = userId;

      newVideoContainer.appendChild(newVideo);
      newVideoContainer.appendChild(userNameDisplay);
      videoGrid.appendChild(newVideoContainer);
    }

    // Apply E2EE transform to the receiver track
    if (e2eeManager.isInitialized) {
      transformManager.setupReceiverTransform(event.receiver, userId);
    }
  };

  // Apply E2EE transform to the sender tracks
  if (e2eeManager.isInitialized) {
    for (const sender of peer.getSenders()) {
      if (sender.track && (sender.track.kind === "video" || sender.track.kind === "audio")) {
        transformManager.setupSenderTransform(sender, userId);
      }
    }
  }

  return peer;
}

async function createOffer(userId) {
  isMakingOffer = true;
  const peer = peers[userId];
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log("📤 Creating offer for", userId);
    ws.send(
      JSON.stringify({
        type: "offer",
        offer,
        room,
        user: name,
        toUser: userId,
      })
    );
  } catch (e) {
    console.error("❌ Failed to create offer:", e);
  } finally {
    isMakingOffer = false;
  }
}

function addParticipant(userId) {
  if (!document.getElementById(`participant-${userId}`)) {
    const li = document.createElement("li");
    li.id = `participant-${userId}`;
    li.textContent = userId;
    participantsList.appendChild(li);
  }
}

function removeParticipant(userId) {
  const li = document.getElementById(`participant-${userId}`);
  if (li) {
    li.remove();
  }
  const videoContainer = document.getElementById(`container-${userId}`);
  if (videoContainer) {
    videoContainer.remove();
  }
}

function addChatMessage(user, text) {
  const messageElement = document.createElement("div");
  messageElement.textContent = `${user}: ${text}`;
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
}

function sendMessage() {
  const text = chatInputField.value;
  if (text.trim() !== "") {
    ws.send(JSON.stringify({ type: "chat", room, user: name, text }));
    addChatMessage(name, text); // Display own message immediately
    chatInputField.value = "";
  }
}

function toggleMute() {
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((track) => (track.enabled = !isMuted));
  const muteBtn = document.getElementById("mute-btn");
  if (isMuted) {
    muteBtn.classList.add("active");
    muteBtn.innerHTML = 
      `<i class="fas fa-microphone-slash"></i>`;
  } else {
    muteBtn.classList.remove("active");
    muteBtn.innerHTML = 
      `<i class="fas fa-microphone"></i>`;
  }
}

function toggleVideo() {
  isVideoOff = !isVideoOff;
  localStream.getVideoTracks().forEach((track) => (track.enabled = !isVideoOff));
  const videoBtn = document.getElementById("video-btn");
  if (isVideoOff) {
    videoBtn.classList.add("active");
    videoBtn.innerHTML = 
      `<i class="fas fa-video-slash"></i>`;
  } else {
    videoBtn.classList.remove("active");
    videoBtn.innerHTML = 
      `<i class="fas fa-video"></i>`;
  }
}

function shareScreen() {
  // Implement screen sharing logic here
  alert("Screen sharing not yet implemented.");
}

function leaveMeeting() {
  ws.send(JSON.stringify({ type: "leave", room, user: name }));
  ws.close();
  window.location.href = "/"; // Redirect to home or a thank you page
}

function toggleChat() {
  const chatContainer = document.getElementById("chat-container");
  chatContainer.classList.toggle("visible");
}

function toggleParticipants() {
  const participantsContainer = document.getElementById("participants-container");
  participantsContainer.classList.toggle("visible");
}

// Update verification status in UI (e.g., next to participant name)
function updateVerificationStatus(userId, isVerified) {
  const participantLi = document.getElementById(`participant-${userId}`);
  if (participantLi) {
    let statusSpan = participantLi.querySelector(".verification-status");
    if (!statusSpan) {
      statusSpan = document.createElement("span");
      statusSpan.classList.add("verification-status", "ms-2");
      participantLi.appendChild(statusSpan);
    }
    if (isVerified) {
      statusSpan.innerHTML = 
        `<i class="fas fa-check-circle text-success" title="Keys Verified"></i>`;
    } else {
      statusSpan.innerHTML = 
        `<i class="fas fa-times-circle text-danger" title="Keys Not Verified"></i>`;
    }
  }
}

// Event listeners for E2EE buttons
document.getElementById("e2ee-verify-btn").addEventListener("click", async () => {
  const participants = Array.from(e2eeManager.participants);
  const otherParticipantId = participants.find(p => p !== name);

  if (!otherParticipantId) {
    alert("No other participants to verify with.");
    return;
  }

  // Generate and display your QR code for the other participant
  try {
    const qrDataString = await keyVerification.generateQRData(otherParticipantId);
    const qrContainer = document.getElementById("e2ee-qrcode");
    qrContainer.innerHTML = ""; // Clear old QR
    new QRCode(qrContainer, qrDataString);
    document.getElementById("e2ee-verify-modal").style.display = "block";
  } catch (error) {
    console.error("❌ Failed to generate E2EE QR code:", error);
    alert("Failed to generate E2EE QR code. Ensure E2EE is initialized and participants are present.");
  }
});

document.getElementById("e2ee-scan-btn").addEventListener("click", openE2EEScanModal);

// New event listener for manual verification button
document.getElementById("manual-e2ee-btn").addEventListener("click", openManualE2EEVerifyModal);

