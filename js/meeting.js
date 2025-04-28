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

const ws = new WebSocket("wss://video-conference-project-production.up.railway.app");
const peers = {};
let localStream;

ws.onopen = () => {
    console.log("✅ WebSocket connected!");
    ws.send(JSON.stringify({ type: "join", room, user: name }));

    // ✅ Add yourself to the participants list immediately
    addParticipant(name);

    startCamera();
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
});

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
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error("Error accessing camera:", error);
    }
}

ws.onmessage = async (message) => {
    try {
        const data = JSON.parse(message.data);
        if (!data.type) return;
        switch (data.type) {
            case "new-user":
                addParticipant(data.user);
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
                removeParticipant(data.user);
                break;
            case "chat":
                displayMessage({ user: data.user, text: data.text, own: false });
                break;
        }
    } catch (error) {
        console.error("Error handling WebSocket message:", error);
    }
};

function createPeer(user) {
    const peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
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

async function createOffer(user) {
    createPeer(user);
    const offer = await peers[user].createOffer();
    await peers[user].setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer, room, user }));
}

async function createAnswer(offer, user) {
    createPeer(user);
    await peers[user].setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peers[user].createAnswer();
    await peers[user].setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "answer", answer, room, user }));
}

function addVideoStream(stream, user) {
    if (document.querySelector(`[data-user="${user}"]`)) return;

    const videoContainer = document.createElement("div");
    videoContainer.classList.add("video-container");

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.setAttribute("data-user", user);

    const nameTag = document.createElement("p");
    nameTag.textContent = user;

    videoContainer.appendChild(video);
    videoContainer.appendChild(nameTag);
    videoGrid.appendChild(videoContainer);

    video.playsInline = true;
    video.muted = user === name;
}

function removeVideoStream(user) {
    const videoElement = document.querySelector(`[data-user="${user}"]`);
    if (videoElement) videoElement.parentElement.remove();
    delete peers[user];
}

function addParticipant(user) {
    if (document.getElementById(`participant-${user}`)) return;
    const participant = document.createElement("p");
    participant.textContent = user;
    participant.id = `participant-${user}`;
    participantsList.appendChild(participant);
}

function removeParticipant(user) {
    const participant = document.getElementById(`participant-${user}`);
    if (participant) participant.remove();
}

function toggleMute() {
    isMuted = !isMuted;
    const audioTracks = localVideo?.srcObject?.getAudioTracks();
    if (audioTracks && audioTracks.length > 0) {
        audioTracks[0].enabled = !isMuted;
    }

    const muteButton = document.getElementById('mute-btn');
    if (muteButton) {
        muteButton.innerHTML = isMuted 
            ? '<i class="fas fa-microphone-slash"></i>' 
            : '<i class="fas fa-microphone"></i>';

        muteButton.classList.toggle('btn-primary', isMuted);  // 🔥 add blue color if muted
        muteButton.classList.toggle('btn-secondary', !isMuted); // 🔥 gray color if unmuted
    }
}

function toggleVideo() {
    isVideoOff = !isVideoOff;
    const videoTracks = localVideo?.srcObject?.getVideoTracks();
    if (videoTracks && videoTracks.length > 0) {
        videoTracks[0].enabled = !isVideoOff;
    }

    const videoButton = document.getElementById('video-btn');
    if (videoButton) {
        videoButton.innerHTML = isVideoOff 
            ? '<i class="fas fa-video-slash"></i>' 
            : '<i class="fas fa-video"></i>';

        videoButton.classList.toggle('btn-primary', isVideoOff);   // 🔥 add blue when video off
        videoButton.classList.toggle('btn-secondary', !isVideoOff); // 🔥 gray when video on
    }
}


let screenStream, screenVideo;

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

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenVideo.remove();
        screenStream = null;
        screenVideo = null;
    }
}

function sendMessage() {
    const message = chatInputField.value.trim();
    if (message) {
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
        if (localVideo?.srcObject) {
            localVideo.srcObject.getTracks().forEach(track => track.stop());
        }
        window.location.href = 'dashboard.html';
    }
}
