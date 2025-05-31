// --- E2EE Integration Start ---
let e2eeKeyManager;
let e2eeManager;

// Helper functions for Base64 encoding/decoding Uint8Arrays
function uint8ArrayToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToUint8Array(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
}

// Chat Encryption/Decryption (using noble-ciphers directly in main thread)
// WARNING: Blocking operation, consider moving to worker if performance issues arise
async function encryptChatMessage(plaintext, key) {
    if (!key || key.byteLength !== 32) {
        console.error("Invalid key for chat encryption");
        return null;
    }
    try {
        const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM-SIV nonce
        const textEncoder = new TextEncoder();
        const plaintextBytes = textEncoder.encode(plaintext);
        // Ensure nobleCiphers is available (loaded globally via meeting.html)
        const siv = nobleCiphers.aes.gcmsiv(key, iv, new Uint8Array()); // No AD for chat
        const ciphertext = siv.encrypt(plaintextBytes);
        
        const combined = new Uint8Array(iv.length + ciphertext.length);
        combined.set(iv, 0);
        combined.set(ciphertext, iv.length);
        
        return uint8ArrayToBase64(combined);
    } catch (error) {
        console.error("Chat encryption failed:", error);
        return null;
    }
}

async function decryptChatMessage(ciphertextBase64, key) {
    if (!key || key.byteLength !== 32) {
        console.error("Invalid key for chat decryption");
        return null;
    }
    try {
        const combined = base64ToUint8Array(ciphertextBase64);
        if (combined.length < 12) {
            console.error("Ciphertext too short to contain IV");
            return null;
        }
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        
        // Ensure nobleCiphers is available
        const siv = nobleCiphers.aes.gcmsiv(key, iv, new Uint8Array()); // No AD for chat
        const decryptedBytes = siv.decrypt(ciphertext);
        
        const textDecoder = new TextDecoder();
        return textDecoder.decode(decryptedBytes);
    } catch (error) {
        console.error("Chat decryption failed:", error);
        return null; // Return null or throw, depending on desired handling
    }
}
// --- E2EE Integration End ---

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
let isSettingRemoteAnswerPending = false;
let localStream;

// --- E2EE Initialization ---
console.log("Initializing E2EE components...");
try {
    // Ensure E2EEKeyManager and E2EEManager classes are loaded via meeting.html
    e2eeKeyManager = new E2EEKeyManager();
    e2eeManager = new E2EEManager({
        keyManager: e2eeKeyManager,
        workerPath: "js/e2ee-worker.js" // Ensure this path is correct
    });
    console.log("E2EE KeyManager and E2EE Manager instantiated.");
} catch (error) {
    console.error("FATAL: Failed to initialize E2EE managers:", error);
    alert("Failed to initialize encryption components. E2EE will not be available.");
    // Optionally disable E2EE features in the UI
}

// اختبار بسيط للـ Local Stream
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
    alert(`Test Stream failed: ${error.name} - ${error.message}. Please check camera/microphone permissions and ensure they are not blocked.`);
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

async function fetchIceServers() {
  return [
    {
      urls: ["stun:fr-turn7.xirsys.com"]
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

// Store original ws.onopen to be called later
const original_ws_onopen = async () => {
  console.log("✅ WebSocket connected! (Original Logic)");
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

// --- Modify ws.onopen (Add E2EE logic) ---
ws.onopen = async () => {
    await original_ws_onopen(); // Call the original onopen logic first

    if (e2eeKeyManager && e2eeManager) {
        try {
            console.log("Initiating E2EE setup...");
            await e2eeKeyManager.generateKeyPair();
            const publicKey = e2eeKeyManager.getPublicKey();
            if (!publicKey) {
                throw new Error("Failed to generate or retrieve public key.");
            }
            const publicKeyBase64 = uint8ArrayToBase64(publicKey);
            
            // Enable E2EE Manager (starts worker)
            await e2eeManager.enable("dh-mode");
            console.log("E2EE Manager enabled.");

            // Send public key to others
            console.log("Broadcasting public key...");
            ws.send(JSON.stringify({
                type: "e2ee-pubkey",
                user: name,
                publicKey: publicKeyBase64,
                room: room
            }));
            console.log("Public key broadcasted.");

        } catch (error) {
            console.error("❌ E2EE Initialization failed:", error);
            alert(`Failed to initialize End-to-End Encryption: ${error.message}`);
            // Consider disabling E2EE features or notifying the user more formally
        }
    } else {
        console.warn("E2EE managers not available, skipping E2EE setup.");
    }
};

ws.onerror = (error) => {
  console.error("❌ WebSocket Error:", error);
  alert("WebSocket connection error. Please check the server and your connection.");
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
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      console.log("✅ Attempt 2: Camera only accessed successfully.");
    } catch (error2) {
      console.warn("⚠️ Attempt 2 failed:", error2.name, error2.message);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        console.log("✅ Attempt 3: Microphone only accessed successfully.");
      } catch (error3) {
        console.error("❌ All attempts failed:", error3.name, error3.message, error3.stack);
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

// Store original ws.onmessage logic
const original_ws_onmessage = async (message) => {
  try {
    const data = JSON.parse(message.data);
    console.log("📩 WebSocket message received (Original Logic):", data);
    if (!data.type) return;

    switch (data.type) {
        case "new-user":
            console.log(`✨ New user joined: ${data.user}`);
            if (data.user !== name) {
              addParticipant(data.user);
              if (localStream) {
                if (!peers[data.user]) {
                  await createPeer(data.user);
                }
                // Send own public key to the new user specifically
                if (e2eeKeyManager && e2eeKeyManager.getPublicKey()) {
                    const publicKeyBase64 = uint8ArrayToBase64(e2eeKeyManager.getPublicKey());
                    console.log(`Sending public key directly to new user ${data.user}`);
                    ws.send(JSON.stringify({
                        type: "e2ee-pubkey",
                        user: name,
                        publicKey: publicKeyBase64,
                        room: room,
                        targetUser: data.user // Optional: For direct signaling if supported
                    }));
                }
                await createOffer(data.user);
              } else {
                console.warn("⚠️ Local stream not ready when new user joined.");
              }
            }
            break;

        case "offer":
            console.log(`📨 Offer received from ${data.user}`);
            const peerOffer = peers[data.user] || await createPeer(data.user);
            const offerCollision = isMakingOffer || peerOffer.signalingState !== "stable";

            isPolite = name.localeCompare(data.user) > 0;
            if (offerCollision && !isPolite) {
              console.warn(`⚠️ Offer collision from ${data.user}, dropping offer`);
              return;
            }

            try {
              await peerOffer.setRemoteDescription(new RTCSessionDescription(data.offer));
              if (peerOffer._bufferedCandidates?.length) {
                  for (const candidate of peerOffer._bufferedCandidates) {
                    try {
                      await peerOffer.addIceCandidate(new RTCIceCandidate(candidate));
                      console.log(`✅ Buffered ICE candidate added for ${data.user}`);
                    } catch (e) {
                      console.error(`❌ Error adding buffered ICE candidate:`, e);
                    }
                  }
                  peerOffer._bufferedCandidates = [];
              }

              console.log(`✅ Remote offer set for ${data.user}`);
              const answer = await peerOffer.createAnswer();
              await peerOffer.setLocalDescription(answer);
              console.log(`✅ Answer created and set for ${data.user}`);
              ws.send(JSON.stringify({ type: "answer", answer, room, user: name, targetUser: data.user }));
            } catch (e) {
              console.error("❌ Failed to handle offer:", e);
            }
            break;

        case "answer":
            console.log(`📬 Answer received from ${data.user}`);
            if (peers[data.user]) {
              const peerAnswer = peers[data.user];
              try {
                await peerAnswer.setRemoteDescription(new RTCSessionDescription(data.answer));
                if (peerAnswer._bufferedCandidates?.length) {
                    for (const candidate of peerAnswer._bufferedCandidates) {
                        try {
                          await peerAnswer.addIceCandidate(new RTCIceCandidate(candidate));
                          console.log(`✅ Buffered ICE candidate added for ${data.user}`);
                        } catch (e) {
                          console.error(`❌ Error adding buffered ICE candidate:`, e);
                        }
                    }
                    peerAnswer._bufferedCandidates = [];
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
            console.log(`🧊 ICE candidate received from ${data.user}`);
            const peerConn = peers[data.user];
            if (peerConn) {
              if (peerConn.remoteDescription && peerConn.remoteDescription.type) {
                try {
                  await peerConn.addIceCandidate(new RTCIceCandidate(data.candidate));
                  console.log(`✅ ICE candidate added for ${data.user}`);
                } catch (e) {
                  console.error(`❌ Error adding ICE candidate for ${data.user}:`, e);
                }
              } else {
                console.log(`📥 Buffering ICE candidate for ${data.user} until remote description is set`);
                peerConn._bufferedCandidates = peerConn._bufferedCandidates || [];
                peerConn._bufferedCandidates.push(data.candidate);
              }
            }
            break;

        case "user-left": // Original handler also needs to process this
            console.log(`🚪 User left (Original Logic): ${data.user}`);
            removeVideoStream(data.user); // This now includes E2EE cleanup
            removeParticipant(data.user);
            break;

        case "chat": // Handle plaintext chat if needed, or ignore if only E2EE chat is used
            console.log(`📩 Plaintext chat message received from ${data.user}: ${data.text}`);
            displayMessage({ user: data.user, text: data.text, own: data.user === name });
            break;

        default:
            console.warn(`❓ Unknown message type in Original Logic: ${data.type}`);
    }
  } catch (error) {
    console.error("❌ Error handling WebSocket message (Original Logic):", error.name, error.message, error.stack);
  }
};

// --- Modify ws.onmessage (Add E2EE logic wrapper) ---
ws.onmessage = async (message) => {
    let isE2EEMessage = false;
    // First, try parsing and handling E2EE messages
    try {
        const data = JSON.parse(message.data);
        // console.log("📩 WebSocket message received (E2EE check):", data);

        if (data.type === "e2ee-pubkey" && data.user !== name) {
            isE2EEMessage = true;
            console.log(`🔑 Received public key from ${data.user}`);
            if (e2eeKeyManager && e2eeManager && data.publicKey) {
                try {
                    const peerPublicKey = base64ToUint8Array(data.publicKey);
                    e2eeKeyManager.addPeerPublicKey(data.user, peerPublicKey);
                    const derivedKey = await e2eeKeyManager.deriveKeyForPeer(data.user);
                    if (derivedKey) {
                        console.log(`🤝 Derived shared key for ${data.user}. Setting in worker...`);
                        await e2eeManager.setPeerKey(data.user, derivedKey);
                    } else {
                        console.error(`Failed to derive key for ${data.user}`);
                    }
                } catch (error) {
                    console.error(`Error processing public key for ${data.user}:`, error);
                }
            } else {
                console.warn(`Skipping public key from ${data.user} - E2EE managers not ready or key missing.`);
            }
        }
        
        if (data.type === "chat-e2ee" && data.fromUser !== name) {
            isE2EEMessage = true;
            console.log(`💬 Received encrypted chat message from ${data.fromUser}`);
            if (e2eeKeyManager && data.ciphertext) {
                const key = e2eeKeyManager.getPeerKey(data.fromUser);
                if (key) {
                    const decryptedText = await decryptChatMessage(data.ciphertext, key);
                    if (decryptedText !== null) {
                        displayMessage({ user: data.fromUser, text: decryptedText, own: false });
                    } else {
                        console.error(`Failed to decrypt message from ${data.fromUser}`);
                        displayMessage({ user: data.fromUser, text: "[Message decryption failed]", own: false });
                    }
                } else {
                    console.warn(`No key found to decrypt message from ${data.fromUser}`);
                    displayMessage({ user: data.fromUser, text: "[Cannot decrypt - key missing]", own: false });
                }
            } else {
                 console.warn(`Skipping encrypted chat from ${data.fromUser} - E2EE key manager not ready or ciphertext missing.`);
            }
        }

        // --- Handle user-left for E2EE key cleanup (redundant with modified removeVideoStream, but safe) ---
        if (data.type === "user-left" && data.user !== name) {
             console.log(`🧹 Cleaning up E2EE keys for left user in ws.onmessage: ${data.user}`);
             if (e2eeKeyManager) {
                 e2eeKeyManager.removePeer(data.user);
             }
        }

    } catch (error) {
        // Ignore parsing errors if it wasn't JSON or didn't have a type we care about
        // console.debug("Ignoring non-JSON or non-E2EE message for E2EE handler");
    }

    // Call the original message handler ONLY if it wasn't an E2EE-specific message we fully handled
    if (!isE2EEMessage) {
        await original_ws_onmessage(message);
    }
};

// Store original createPeer
const original_createPeer = async (user) => {
  console.log(`🤝 Creating RTCPeerConnection for user: ${user} (Original Logic)`);
  const iceServers = await fetchIceServers();
  console.log("🧊 ICE Servers used:", iceServers);
  const peer = new RTCPeerConnection({
    iceServers: iceServers
  });

  peer.oniceconnectionstatechange = () => {
    console.log(`🔌 ICE state for ${user}:`, peer.iceConnectionState);
    if (["failed", "disconnected", "closed"].includes(peer.iceConnectionState)) {
      console.error(`❌ ICE connection for ${user} failed/disconnected. State: ${peer.iceConnectionState}`);
      // Consider attempting ICE restart here
    }
  };
  peer.onconnectionstatechange = () => {
    console.log(`🌐 Connection state for ${user}:`, peer.connectionState);
    if (peer.connectionState === "connected") {
      console.log(`✅ Peer connection established with ${user}`);
    } else if (peer.connectionState === "failed") {
      console.error(`❌ Peer connection failed with ${user}`);
      // Consider attempting ICE restart or notifying user
    }
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`🧊 Sending ICE candidate to ${user}:`, event.candidate);
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user: name, targetUser: user }));
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
      console.log(`➕ Adding local track for ${user}:`, { kind: track.kind, enabled: track.enabled, id: track.id });
      try {
          const sender = peer.addTrack(track, localStream);
          console.log(`✅ Added ${track.kind} track with sender:`, sender);
      } catch (e) {
          console.error(`❌ Error adding ${track.kind} track for ${user}:`, e);
      }
    });
  } else {
    console.error("❌ No localStream available when creating peer:", user);
  }

  peers[user] = peer;
  return peer; 
};

// --- Modify createPeer (Add E2EE logic) ---
createPeer = async (user) => {
    const peer = await original_createPeer(user); // Call original function first
    if (peer && e2eeManager) {
        console.log(`🔗 Associating peer connection for ${user} with E2EE Manager.`);
        e2eeManager.addPeerConnection(peer, user);
        // Attempt to derive and set key if public key already received
        if (e2eeKeyManager) {
             const peerInfo = e2eeKeyManager.peerKeys.get(user);
             if (peerInfo && peerInfo.publicKey && !peerInfo.sharedKey) {
                 console.log(`Deriving key for ${user} upon peer creation...`);
                 const derivedKey = await e2eeKeyManager.deriveKeyForPeer(user);
                 if (derivedKey) {
                     await e2eeManager.setPeerKey(user, derivedKey);
                 }
             }
        }
    }
    return peer;
};

async function createOffer(user) {
  console.log(`📨 Creating offer for ${user}`);
  if (!peers[user]) await createPeer(user);
  try {
    const peer = peers[user];
    // Perfect negotiation logic: Check if we are polite and if an offer is incoming
    isMakingOffer = true;
    console.log(`🔍 Signaling state before creating offer for ${user}:`, peer.signalingState);
    const offer = await peer.createOffer();
    // Check signaling state again before setting local description
    if (peer.signalingState !== "stable") {
        console.warn(`⚠️ Signaling state changed before setting local offer for ${user}. Current state: ${peer.signalingState}`);
        // Potentially handle this, e.g., by restarting the offer process if needed
    }
    await peer.setLocalDescription(offer);
    console.log(`✅ Offer created and set for ${user}. New signaling state:`, peer.signalingState);
    ws.send(JSON.stringify({ type: "offer", offer, room, user: name, targetUser: user }));
  } catch (e) {
    console.error("❌ Error creating offer:", e.message, e.stack);
  } finally {
    isMakingOffer = false;
  }
}

// createAnswer is part of the original ws.onmessage logic, no separate function needed here

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

// Store original removeVideoStream
const original_removeVideoStream = (user) => {
  console.log(`➖ Removing video stream for ${user} (Original Logic)`);
  const container = document.querySelector(`div[data-user-container="${user}"]`);
  if (container) container.remove();
  const peer = peers[user];
  if (peer) {
    peer.close();
    console.log(`Peer connection closed for ${user}`);
    delete peers[user];
  }
};

// --- Modify removeVideoStream (Add E2EE cleanup) ---
removeVideoStream = (user) => {
    console.log(`🧹 E2EE Cleanup for ${user} in removeVideoStream...`);
    const peer = peers[user]; // Get peer before original function potentially deletes it
    if (peer && e2eeManager) {
        console.log(`🔗 Disassociating peer connection for ${user} from E2EE Manager.`);
        e2eeManager.removePeerConnection(peer);
    }
    if (e2eeKeyManager) {
        e2eeKeyManager.removePeer(user); // Also remove key material
    }
    original_removeVideoStream(user); // Call original function to close peer and remove element
};

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

    // Replace video track for all peers
    const screenTrack = screenStream.getVideoTracks()[0];
    for (const peerId in peers) {
        const peer = peers[peerId];
        const sender = peer.getSenders().find(s => s.track?.kind === "video");
        if (sender) {
            console.log(`Replacing video track with screen share for ${peerId}`);
            await sender.replaceTrack(screenTrack);
        } else {
            console.warn(`No video sender found for ${peerId} to replace with screen share.`);
        }
    }

    screenTrack.onended = () => {
      console.log("🛑 Screen share ended by user.");
      stopScreenShare();
    };
    // Update UI button state if needed

  } catch (error) {
    console.error("❌ Error sharing screen:", error);
    alert(`Error sharing screen: ${error.name} - ${error.message}`);
  }
}

async function stopScreenShare() {
  console.log("🛑 Stopping screen share...");
  if (!screenStream) return;

  screenStream.getTracks().forEach(t => t.stop());
  screenVideoElement?.remove();
  screenStream = null;
  screenVideoElement = null;

  // Replace screen track with camera track for all peers
  const cameraTrack = localStream?.getVideoTracks()[0];
  if (cameraTrack) {
      for (const peerId in peers) {
          const peer = peers[peerId];
          const sender = peer.getSenders().find(s => s.track?.kind === "video");
          if (sender) {
              console.log(`Replacing screen share with camera track for ${peerId}`);
              await sender.replaceTrack(cameraTrack);
          } else {
              console.warn(`No video sender found for ${peerId} to replace with camera track.`);
          }
      }
  } else {
      console.warn("No camera track available to restore after screen share.");
  }
  // Update UI button state if needed
}

// --- Modify sendMessage (Replace original with E2EE version) --- 
sendMessage = async () => {
    const msg = chatInputField.value.trim();
    if (!msg) return;
    if (!e2eeKeyManager || !e2eeManager || !e2eeManager.isReady()) {
        // Check if E2EE is enabled and ready before allowing send
        alert("Cannot send message: End-to-End Encryption is not fully initialized or enabled.");
        console.warn("Attempted to send chat message before E2EE was ready.");
        return;
    }

    console.log(`💬 Encrypting and sending message: ${msg}`);
    displayMessage({ user: name, text: msg, own: true }); // Display own message immediately (plaintext)
    chatInputField.value = "";

    let sentCount = 0;
    const peerIds = Object.keys(peers);
    if (peerIds.length === 0) {
        console.log("No peers connected to send chat message to.");
        return;
    }

    for (const peerId of peerIds) {
        if (peerId !== name) { // Don't send to self
            const key = e2eeKeyManager.getPeerKey(peerId);
            if (key) {
                const encryptedMsgBase64 = await encryptChatMessage(msg, key);
                if (encryptedMsgBase64) {
                    ws.send(JSON.stringify({
                        type: "chat-e2ee",
                        toUser: peerId, // Specify recipient for potential server-side routing
                        fromUser: name,
                        ciphertext: encryptedMsgBase64,
                        room: room
                    }));
                    sentCount++;
                    console.log(`-> Sent encrypted message to ${peerId}`);
                } else {
                    console.error(`Failed to encrypt message for ${peerId}`);
                    // Optionally notify user or try again?
                }
            } else {
                console.warn(`Cannot send encrypted message to ${peerId}: No shared key available. Key exchange might not be complete.`);
                // Maybe queue the message or notify the user?
            }
        }
    }
    console.log(`Finished sending chat message attempt to ${sentCount} peers.`);
};

function displayMessage({ user, text, own }) {
  console.log(`📩 Displaying message from ${user}: ${text}`);
  const el = document.createElement("p");
  // Basic sanitization to prevent HTML injection - consider a more robust library for production
  const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  el.innerHTML = `<strong>${user}:</strong> ${sanitizedText}`;
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

// Store original leaveMeeting
const original_leaveMeeting = () => {
  if (!confirm("Are you sure you want to leave the meeting?")) return;
  console.log("🚪 Leaving meeting... (Original Logic)");
  localStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(p => p.close()); // Close peers before clearing the map
  // Clear peers map explicitly if not handled by removeVideoStream calls
  // for (const peerId in peers) { delete peers[peerId]; }
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html"; // Redirect after cleanup
};

// --- Modify leaveMeeting (Add E2EE cleanup) ---
leaveMeeting = () => {
    console.log("🚪 Disabling E2EE on leave...");
    if (e2eeManager) {
        e2eeManager.disable(); // This should handle removing transforms etc.
    }
    if (e2eeKeyManager) {
        e2eeKeyManager.disable(); // This cleans up key material
    }
    original_leaveMeeting(); // Call original function to close connections and redirect
};

