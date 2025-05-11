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
// Ensure the WebSocket URL is correct for your deployment
const ws = new WebSocket("wss://video-conference-project-production-65d5.up.railway.app"); // Or your local/dev server, e.g., "ws://localhost:3001"
const peers = {};
let localStream;

console.log("Attempting to connect to WebSocket server...");

ws.onopen = () => {
    console.log("✅ WebSocket connected!");
    ws.send(JSON.stringify({ type: "join", room, user: name }));
    addParticipant(name); // Add self to participant list
    startCamera();
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

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("meeting-id-display")) {
        document.getElementById("meeting-id-display").textContent = `#${room}`;
    }
    if (document.getElementById("user-name-display")) {
        document.getElementById("user-name-display").textContent = name;
    }
});

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
        console.log("✅ Camera and microphone access granted.");
        localVideo.srcObject = localStream;
        localVideo.muted = true; // Mute local video by default to prevent echo
        // Notify other users only after local stream is ready
        // This is handled by the 'new-user' -> 'offer' flow triggered by ws.onmessage
    } catch (error) {
        console.error("❌ Error accessing camera and/or microphone:", error);
        alert(`Error accessing camera/microphone: ${error.name} - ${error.message}. Please check permissions.`);
    }
}

ws.onmessage = async (message) => {
    try {
        const data = JSON.parse(message.data);
        console.log("📩 WebSocket message received:", data);
        if (!data.type) return;

        switch (data.type) {
            case "new-user":
                console.log(`✨ New user joined: ${data.user}`);
                addParticipant(data.user);
                if (localStream) { // Only create offer if local stream is ready
                    await createOffer(data.user);
                } else {
                    console.warn("⚠️ Local stream not ready when new user joined. Offer will be created once stream is available.");
                    // Potentially queue this user or handle later when localStream is ready
                }
                break;
            case "offer":
                console.log(`📨 Offer received from ${data.user}`);
                if (localStream) { // Only create answer if local stream is ready
                    await createAnswer(data.offer, data.user);
                } else {
                     console.warn("⚠️ Local stream not ready when offer received. Answer cannot be created yet.");
                }
                break;
            case "answer":
                console.log(`📬 Answer received from ${data.user}`);
                if (peers[data.user]) {
                    await peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
                    console.log(`✅ Remote description (answer) set for ${data.user}`);
                } else {
                    console.warn(`⚠️ Received answer from unknown peer: ${data.user}`);
                }
                break;
            case "candidate":
                console.log(`🧊 ICE candidate received from ${data.user}`);
                if (peers[data.user]) {
                    try {
                        await peers[data.user].addIceCandidate(new RTCIceCandidate(data.candidate));
                        console.log(`✅ ICE candidate added for ${data.user}`);
                    } catch (e) {
                        console.error("❌ Error adding received ICE candidate:", e);
                    }
                } else {
                    console.warn(`⚠️ Received ICE candidate from unknown peer: ${data.user}`);
                }
                break;
            case "user-left":
                console.log(`🚪 User left: ${data.user}`);
                removeVideoStream(data.user);
                removeParticipant(data.user);
                break;
            case "chat":
                displayMessage({ user: data.user, text: data.text, own: false });
                break;
            default:
                console.warn(`❓ Unknown WebSocket message type: ${data.type}`);
        }
    } catch (error) {
        console.error("❌ Error handling WebSocket message:", error);
    }
};

function createPeer(user) {
    console.log(`🤝 Creating RTCPeerConnection for user: ${user}`);
    const peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            {
                urls: "turn:a.relay.metered.ca:443",
                username: "openai",
                credential: "openai"
            }
        ]
    });



    peer.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`🧊 Sending ICE candidate to ${user}:`, event.candidate);
            ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user }));
        } else {
            console.log(`🏁 All ICE candidates have been sent for ${user}.`);
        }
    };

    peer.onicegatheringstatechange = () => {
        if (peer) console.log(`🧊 ICE gathering state changed for ${user}: ${peer.iceGatheringState}`);
    };

    peer.oniceconnectionstatechange = () => {
        if (peer) {
            console.log(`🔗 ICE connection state changed for ${user}: ${peer.iceConnectionState}`);
            if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected" || peer.iceConnectionState === "closed") {
                console.error(`❌ ICE connection for ${user} failed or disconnected.`);
                // Optionally, try to restart ICE or notify the user
            }
        }
    };

    peer.onconnectionstatechange = () => {
        if(peer) {
            console.log(`🔗 Peer connection state changed for ${user}: ${peer.connectionState}`);
            if (peer.connectionState === "connected") {
                console.log(`✅ Peer connection established with ${user}`);
            } else if (peer.connectionState === "failed") {
                console.error(`❌ Peer connection failed with ${user}`);
            }
        }
    };

    peer.ontrack = (event) => {
        console.log(`🎞️ Track received from ${user}:`, event.streams[0]);
        addVideoStream(event.streams[0], user);
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`➕ Adding local track to peer connection for ${user}:`, track);
            peer.addTrack(track, localStream);
        });
    } else {
        console.error("❌ Cannot add tracks: Local stream is not available when creating peer.");
    }

    peers[user] = peer;
}

async function createOffer(user) {
    console.log(`📨 Creating offer for ${user}`);
    if (!peers[user]) createPeer(user);
    try {
        const offer = await peers[user].createOffer();
        await peers[user].setLocalDescription(offer);
        console.log(`✅ Local description (offer) set for ${user}. Sending offer...`);
        ws.send(JSON.stringify({ type: "offer", offer, room, user }));
    } catch (e) {
        console.error("❌ Error creating offer or setting local description:", e);
    }
}

async function createAnswer(offer, user) {
    console.log(`📬 Creating answer for ${user}`);
    if (!peers[user]) createPeer(user);
    try {
        await peers[user].setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`✅ Remote description (offer) set for ${user}. Creating answer...`);
        const answer = await peers[user].createAnswer();
        await peers[user].setLocalDescription(answer);
        console.log(`✅ Local description (answer) set for ${user}. Sending answer...`);
        ws.send(JSON.stringify({ type: "answer", answer, room, user }));
    } catch (e) {
        console.error("❌ Error creating answer or setting descriptions:", e);
    }
}

function addVideoStream(stream, user) {
    if (document.querySelector(`video[data-user="${user}"]`)) {
        console.log(`📹 Video stream for ${user} already exists.`);
        return;
    }
    console.log(`➕ Adding video stream for user: ${user}`);

    const videoContainer = document.createElement("div");
    videoContainer.classList.add("video-container");
    videoContainer.setAttribute("data-user-container", user);

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true; // Important for iOS
    video.setAttribute("data-user", user);
    // Do not mute remote streams by default
    // video.muted = user === name; // This would mute remote users if their name matches local user, which is unlikely and not desired.

    const nameTag = document.createElement("p");
    nameTag.textContent = user;

    videoContainer.appendChild(video);
    videoContainer.appendChild(nameTag);
    videoGrid.appendChild(videoContainer);
    console.log(`✅ Video element for ${user} added to grid.`);
}

function removeVideoStream(user) {
    console.log(`➖ Removing video stream for user: ${user}`);
    const videoContainer = document.querySelector(`div[data-user-container="${user}"]`);
    if (videoContainer) {
        videoContainer.remove();
        console.log(`✅ Video container for ${user} removed.`);
    }
    if (peers[user]) {
        peers[user].close();
        delete peers[user];
        console.log(`🚪 Peer connection for ${user} closed and deleted.`);
    }
}

function addParticipant(user) {
    if (document.getElementById(`participant-${user}`)) return;
    const participant = document.createElement("p");
    participant.textContent = user;
    participant.id = `participant-${user}`;
    participantsList.appendChild(participant);
    console.log(`👥 Participant ${user} added to list.`);
}

function removeParticipant(user) {
    const participant = document.getElementById(`participant-${user}`);
    if (participant) {
        participant.remove();
        console.log(`👤 Participant ${user} removed from list.`);
    }
}

function toggleMute() {
    if (!localStream) {
      console.error("🎤 No local stream available to mute/unmute.");
      return;
    }
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      isMuted = !isMuted;
      audioTracks[0].enabled = !isMuted;
      console.log(`🎤 Audio ${isMuted ? "muted" : "unmuted"}`);
      const muteButton = document.getElementById("mute-btn");
      if (muteButton) {
        muteButton.classList.toggle("active", isMuted);
        muteButton.textContent = isMuted ? "Unmute" : "Mute";
      }
    } else {
      console.error("🎤 No audio tracks found in local stream.");
    }
}
  
function toggleVideo() {
    if (!localStream) {
        console.error("📹 No local stream available to toggle video.");
        return;
    }
    isVideoOff = !isVideoOff;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
        videoTracks[0].enabled = !isVideoOff;
        console.log(`📹 Video ${isVideoOff ? "disabled" : "enabled"}`);
    }
    const videoButton = document.getElementById("video-btn");
    if (videoButton) {
        videoButton.classList.toggle("active", isVideoOff);
        videoButton.textContent = isVideoOff ? "Show Video" : "Hide Video";
    }
}

let screenStream, screenVideoElement; // Renamed screenVideo to screenVideoElement to avoid confusion

async function shareScreen() {
    console.log("🖥️ Attempting to share screen...");
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        console.log("✅ Screen share access granted.");
        screenVideoElement = document.createElement("video");
        screenVideoElement.srcObject = screenStream;
        screenVideoElement.autoplay = true;
        screenVideoElement.id = "screen-share";
        screenVideoElement.style.width = "100%"; // Consider more robust styling
        videoGrid.appendChild(screenVideoElement);
        console.log("📺 Screen share video element added.");

        // Handle replacing tracks for existing peers
        Object.values(peers).forEach(peer => {
            const sender = peer.getSenders().find(s => s.track && s.track.kind === "video");
            if (sender) {
                sender.replaceTrack(screenStream.getVideoTracks()[0]);
            }
        });

        screenStream.getVideoTracks()[0].onended = () => {
            console.log("🛑 Screen share ended by user (via browser UI).");
            stopScreenShare(true); // Pass true to indicate it was stopped by track ending
        };
    } catch (error) {
        console.error("❌ Error sharing screen:", error);
        alert(`Error sharing screen: ${error.name} - ${error.message}`);
    }
}

function stopScreenShare(trackEnded = false) {
    console.log("🛑 Attempting to stop screen share...");
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        console.log("🛤️ Screen share tracks stopped.");
    }
    if (screenVideoElement) {
        screenVideoElement.remove();
        screenVideoElement = null;
        console.log("🗑️ Screen share video element removed.");
    }

    // Revert to camera video for existing peers
    if (localStream) {
        const cameraVideoTrack = localStream.getVideoTracks()[0];
        if (cameraVideoTrack) {
            Object.values(peers).forEach(peer => {
                const sender = peer.getSenders().find(s => s.track && s.track.kind === "video");
                if (sender) {
                    sender.replaceTrack(cameraVideoTrack);
                }
            });
        }
    }
    screenStream = null;
    console.log("✅ Screen share stopped successfully.");
}

function sendMessage() {
    const message = chatInputField.value.trim();
    if (message) {
        console.log(`💬 Sending chat message: ${message}`);
        ws.send(JSON.stringify({ type: "chat", user: name, text: message }));
        displayMessage({ user: name, text: message, own: true });
        chatInputField.value = "";
    }
}

function displayMessage({ user, text, own }) {
    const messageElement = document.createElement("p");
    messageElement.innerHTML = `<strong>${user}:</strong> ${text}`;
    if (own) messageElement.classList.add("own-message");
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll to latest message
}

function toggleChat() {
    document.getElementById("chat-container").classList.toggle("visible");
}

function toggleParticipants() {
    document.getElementById("participants-container").classList.toggle("visible");
}

function leaveMeeting() {
    const confirmLeave = confirm("Are you sure you want to leave the meeting?");
    if (confirmLeave) {
        console.log("🚪 Leaving meeting...");
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            console.log("🛑 Local media tracks stopped.");
        }
        Object.values(peers).forEach(peer => peer.close());
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "leave", room, user: name }));
            ws.close();
        }
        console.log("Redirecting to dashboard...");
        window.location.href = "dashboard.html";
    }
}

