// public/js/main.js
// Function to parse URL parameters
function getQueryParams() {
    const params = {};
    window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) {
        params[key] = decodeURIComponent(value);
    });
    return params;
}

// Extract room ID and user name from URL
const { room, name } = getQueryParams();

// Ensure DOM elements exist before modifying them
document.addEventListener("DOMContentLoaded", () => {
    const meetingIdDisplay = document.getElementById('meeting-id-display');
    const userNameDisplay = document.getElementById('user-name-display');

    if (meetingIdDisplay) {
        meetingIdDisplay.textContent = `#${room}`;
    } else {
        console.error("❌ Error: meeting-id-display element not found!");
    }

    if (userNameDisplay) {
        userNameDisplay.textContent = name;
    } else {
        console.error("❌ Error: user-name-display element not found!");
    }
});

// Get essential DOM elements
const localVideo = document.getElementById('local-video');
const videoGrid = document.getElementById('video-grid');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const participantsList = document.getElementById('participants-list');
const chatContainer = document.getElementById('chat-container');
const participantsContainer = document.getElementById('participants-container');

// Flags for mute and video
let isMuted = false;
let isVideoOff = false;

// Access user's camera and microphone
navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
}).then(stream => {
    if (localVideo) {
        localVideo.srcObject = stream;
        localVideo.play();
        addVideoStream(localVideo, name);
    } else {
        console.error("❌ Error: local-video element not found!");
    }
}).catch(error => {
    console.error('Error accessing media devices.', error);
});

// Function to add video stream to the grid
function addVideoStream(video, username) {
    if (!videoGrid) {
        console.error("❌ Error: video-grid element not found!");
        return;
    }

    const videoContainer = document.createElement('div');
    videoContainer.classList.add('video-container');

    videoContainer.appendChild(video);

    const nameTag = document.createElement('p');
    nameTag.textContent = username;
    videoContainer.appendChild(nameTag);

    videoGrid.appendChild(videoContainer);
}

// Toggle Mute/Unmute Microphone
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
        muteButton.classList.toggle('active', isMuted);
    }
}

// Toggle Start/Stop Video
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
        videoButton.classList.toggle('active', isVideoOff);
    }
}

// Share Screen Functionality
function shareScreen() {
    navigator.mediaDevices.getDisplayMedia({
        video: true
    }).then(screenStream => {
        const screenVideo = document.createElement('video');
        screenVideo.srcObject = screenStream;
        screenVideo.autoplay = true;
        screenVideo.className = 'screen-video';
        screenVideo.style.border = '2px solid #28a745';

        addVideoStream(screenVideo, 'Screen Share');

        screenStream.getTracks()[0].onended = () => {
            const videos = document.querySelectorAll('.screen-video');
            videos.forEach(v => v.parentElement.remove());
        };
    }).catch(error => {
        console.error('Error sharing screen:', error);
    });
}

// Send Chat Message
function sendMessage() {
    const message = chatInputField?.value.trim();
    if (message && chatMessages) {
        displayMessage({ user: name, text: message, own: true });
        chatInputField.value = "";
    }
}

// Display Chat Message
function displayMessage(message) {
    if (!chatMessages) {
        console.error("❌ Error: chat-messages element not found!");
        return;
    }

    const messageElement = document.createElement('p');
    messageElement.innerHTML = `<strong>${message.user}:</strong> ${message.text}`;
    if (message.own) {
        messageElement.classList.add('own-message');
    }
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Toggle Chat Visibility
function toggleChat() {
    if (chatContainer) {
        chatContainer.classList.toggle('visible');
    } else {
        console.error("❌ Error: chat-container element not found!");
    }
}

// Toggle Participants Visibility
function toggleParticipants() {
    if (participantsContainer) {
        participantsContainer.classList.toggle('visible');
    } else {
        console.error("❌ Error: participants-container element not found!");
    }
}

// Function to add participants to the list
function addParticipant(name) {
    if (!participantsList) {
        console.error("❌ Error: participants-list element not found!");
        return;
    }

    const participant = document.createElement('p');
    participant.textContent = name;
    participantsList.appendChild(participant);
}

// Adding dummy participants (Replace with real data when backend is connected)
addParticipant('User One');
addParticipant('User Two');
addParticipant('User Three');

// Active Speaker Indicator (Requires backend integration)
function setActiveSpeaker(videoElement) {
    document.querySelectorAll('.video-container').forEach(vc => vc.classList.remove('active-speaker'));
    videoElement.parentElement.classList.add('active-speaker');
}

document.addEventListener("DOMContentLoaded", () => {
    const leaveBtn = document.getElementById("leave-btn");
    if (leaveBtn) {
        leaveBtn.addEventListener("click", leaveMeeting);
    }
});
