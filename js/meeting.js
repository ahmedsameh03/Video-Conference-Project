// Parse URL Parameters
function getQueryParams() {
    const params = {};
    window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) {
        params[key] = decodeURIComponent(value);
    });
    return params;
}

const { room, name } = getQueryParams();
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('meeting-id-display').textContent = `#${room}`;
    document.getElementById('user-name-display').textContent = name;
});

// WebRTC and UI Elements
const localVideo = document.getElementById("large-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");

const ws = new WebSocket("ws://localhost:3000");
const peers = {};
let localStream;

// ✅ Start Camera & Microphone (Show in Middle Box)
async function startCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localVideo.play();
        ws.send(JSON.stringify({ type: "join", room, user: name }));
    } catch (error) {
        console.error("Error accessing camera:", error);
    }
}

// ✅ Handle WebSocket Messages
ws.onmessage = async (message) => {
    const data = JSON.parse(message.data);

    switch (data.type) {
        case "new-user":
            createOffer(data.user);
            break;
        case "offer":
            createAnswer(data.offer, data.user);
            break;
        case "answer":
            peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
        case "candidate":
            peers[data.user]?.addIceCandidate(new RTCIceCandidate(data.candidate));
            break;
        case "user-left":
            removeVideoStream(data.user);
            break;
    }
};

// ✅ Create WebRTC Peer Connection
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

// ✅ Create Offer for New User
async function createOffer(user) {
    createPeer(user);
    const offer = await peers[user].createOffer();
    await peers[user].setLocalDescription(offer);

    ws.send(JSON.stringify({ type: "offer", offer, room, user }));
}

// ✅ Create Answer for Offer
async function createAnswer(offer, user) {
    createPeer(user);
    await peers[user].setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peers[user].createAnswer();
    await peers[user].setLocalDescription(answer);

    ws.send(JSON.stringify({ type: "answer", answer, room, user }));
}

// ✅ Add Video Stream to Grid
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

// ✅ Remove Video When User Leaves
function removeVideoStream(user) {
    document.querySelector(`[data-user="${user}"]`)?.remove();
}

// ✅ Toggle Video
function toggleVideo() {
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
        videoTracks[0].enabled = !videoTracks[0].enabled;
    }

    const videoButton = document.getElementById('video-btn');
    videoButton.classList.toggle("active");
    videoButton.innerHTML = videoTracks[0].enabled
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
}

// ✅ Toggle Mute
function toggleMute() {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        audioTracks[0].enabled = !audioTracks[0].enabled;
    }

    const muteButton = document.getElementById('mute-btn');
    muteButton.classList.toggle("active");
    muteButton.innerHTML = audioTracks[0].enabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
}

let screenStream;
let screenVideo;

async function shareScreen() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

        // Check if screen sharing is already active
        if (screenVideo) {
            screenVideo.srcObject = screenStream;
            return;
        }

        // Create a new video element for screen sharing
        screenVideo = document.createElement("video");
        screenVideo.srcObject = screenStream;
        screenVideo.autoplay = true;
        screenVideo.id = "screen-share";
        screenVideo.style.width = "100%";

        // Append the video to the main video container
        const videoGrid = document.getElementById("video-grid");
        videoGrid.appendChild(screenVideo);

        // Stop sharing when user closes it
        screenStream.getVideoTracks()[0].onended = function () {
            stopScreenShare();
        };
    } catch (error) {
        console.error("Error sharing screen:", error);
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop()); // Stop the stream
        screenVideo.remove(); // Remove the video element
        screenStream = null;
        screenVideo = null;
    }
}


// ✅ Send Chat Message
function sendMessage() {
    const message = chatInputField.value.trim();
    if (message !== "") {
        ws.send(JSON.stringify({ type: "chat", user: name, text: message }));
        displayMessage({ user: name, text: message, own: true });
        chatInputField.value = "";
    }
}

ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "chat") {
        displayMessage({ user: data.user, text: data.text, own: false });
    }
};


// ✅ Display Chat Message
function displayMessage(message) {
    const messageElement = document.createElement("p");
    messageElement.innerHTML = `<strong>${message.user}:</strong> ${message.text}`;
    if (message.own) messageElement.classList.add("own-message");

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ✅ Toggle Chat
function toggleChat() {
    document.getElementById("chat-container").classList.toggle("visible");
}

// ✅ Toggle Participants
function toggleParticipants() {
    document.getElementById("participants-container").classList.toggle("visible");
}

// ✅ Leave Meeting
function leaveMeeting() {
    if (confirm("Are you sure you want to leave?")) {
        ws.send(JSON.stringify({ type: "user-left", user: name, room }));
        ws.close();
        window.location.href = "index.html";
    }
}

window.addEventListener("beforeunload", () => {
    socket.emit("user-disconnected", userId); // Notify server to remove user
});
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => console.log("Stream acquired:", stream))
    .catch((err) => console.error("Camera error:", err));

// ✅ Start Camera When Page Loads
startCamera();
