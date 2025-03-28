// Parse URL Parameters
const queryParams = getQueryParams();
const room = queryParams.room;
const name = queryParams.name;

// WebRTC and UI Elements
const localVideo = document.getElementById("large-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");

const ws = new WebSocket("wss://video-conference-project.onrender.com");
const peers = {};
let localStream;

// WebSocket Event Handlers
ws.onopen = () => {
    console.log("WebSocket connected!");
    ws.send(JSON.stringify({ type: "join", room, user: name }));
};

ws.onerror = (error) => {
    console.error("WebSocket Error:", error);
};

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById('meeting-id-display')) {
        document.getElementById('meeting-id-display').textContent = `#${room}`;
    }
    if (document.getElementById('user-name-display')) {
        document.getElementById('user-name-display').textContent = name;
    }
    startCamera();
}); 

function getQueryParams() {
    const params = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
        params[key] = decodeURIComponent(value);
    });
    return params;
}
// Start Camera & Microphone
async function startCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error("Error accessing camera:", error);
    }
}

// Handle WebSocket Messages
ws.onmessage = async (message) => {
    try {
        const data = JSON.parse(message.data);
        if (!data.type) return;

        switch (data.type) {
            case "new-user":
                await createOffer(data.user);
                break;
            case "offer":
                await createAnswer(data.offer, data.user);
                break;
            case "answer":
                if (peers[data.user]) {
                    await peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
                }
                break;
            case "candidate":
                if (peers[data.user]) {
                    await peers[data.user].addIceCandidate(new RTCIceCandidate(data.candidate));
                }
                break;
            case "user-left":
                removeVideoStream(data.user);
                break;
            case "chat":
                displayMessage({ user: data.user, text: data.text, own: false });
                break;
        }
    } catch (error) {
        console.error("Error handling WebSocket message:", error);
    }
};

// Create WebRTC Peer Connection
function createPeer(user) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate, room, user }));
        }
    };

    peer.ontrack = (event) => {
        addVideoStream(event.streams[0], user);
    };

    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peers[user] = peer;
}

// Create Offer for New User
async function createOffer(user) {
    createPeer(user);
    const offer = await peers[user].createOffer();
    await peers[user].setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer, room, user }));
}

// Create Answer for Offer
async function createAnswer(offer, user) {
    createPeer(user);
    await peers[user].setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peers[user].createAnswer();
    await peers[user].setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "answer", answer, room, user }));
}

// Add Video Stream to Grid
function addVideoStream(stream, user) {
    const videoContainer = document.createElement("div");
    videoContainer.classList.add("video-container");

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.setAttribute("data-user", user);
    videoContainer.appendChild(video);

    const nameTag = document.createElement("p");
    nameTag.textContent = user;
    videoContainer.appendChild(nameTag);

    videoGrid.appendChild(videoContainer);
}

// Remove Video When User Leaves
function removeVideoStream(user) {
    const videoElement = document.querySelector(`[data-user="${user}"]`);
    if (videoElement) videoElement.parentElement.remove();
    delete peers[user];
}

// Toggle Video
function toggleVideo() {
    localStream.getVideoTracks()[0].enabled = !localStream.getVideoTracks()[0].enabled;
}

// Toggle Mute
function toggleMute() {
    localStream.getAudioTracks()[0].enabled = !localStream.getAudioTracks()[0].enabled;
}

let screenStream;
let screenVideo;

// Share Screen
async function shareScreen() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenVideo = document.createElement("video");
        screenVideo.srcObject = screenStream;
        screenVideo.autoplay = true;
        screenVideo.id = "screen-share";
        screenVideo.style.width = "100%";
        videoGrid.appendChild(screenVideo);

        screenStream.getVideoTracks()[0].onended = stopScreenShare;
    } catch (error) {
        console.error("Error sharing screen:", error);
    }
}

// Stop Screen Sharing
function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenVideo.remove();
        screenStream = null;
        screenVideo = null;
    }
}

// Send Chat Message
function sendMessage() {
    const message = chatInputField.value.trim();
    if (message) {
        ws.send(JSON.stringify({ type: "chat", user: name, text: message }));
        displayMessage({ user: name, text: message, own: true });
        chatInputField.value = "";
    }
}

// Display Chat Message
function displayMessage({ user, text, own }) {
    const messageElement = document.createElement("p");
    messageElement.innerHTML = `<strong>${user}:</strong> ${text}`;
    if (own) messageElement.classList.add("own-message");
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Toggle Chat
function toggleChat() {
    document.getElementById("chat-container").classList.toggle("visible");
}

// Toggle Participants
function toggleParticipants() {
    document.getElementById("participants-container").classList.toggle("visible");
}

function leaveMeeting() {
    const confirmLeave = confirm("Are you sure you want to leave the meeting?");
    if (confirmLeave) {
        if (localVideo?.srcObject) {
            localVideo.srcObject.getTracks().forEach(track => track.stop());
        }
        window.location.href = 'dashboard.html';
    }
}
