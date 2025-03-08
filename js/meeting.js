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

// Update meeting ID and user name in the navbar
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('meeting-id-display').textContent = `#${room}`;
    document.getElementById('user-name-display').textContent = name;
});

// Get elements
const localVideo = document.getElementById('large-video'); // Large video box
const videoGrid = document.getElementById('video-grid');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const participantsList = document.getElementById('participants-list');

// Flags for mute and video
let isMuted = false;
let isVideoOff = true;
let localStream = null;

// Function to start or stop video
async function toggleVideo() {
    const videoButton = document.getElementById('video-btn');

    if (isVideoOff) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            localVideo.play();
            isVideoOff = false;
            videoButton.innerHTML = '<i class="fas fa-video"></i>';
            videoButton.classList.remove('active');
        } catch (error) {
            console.error('Error accessing media devices.', error);
        }
    } else {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        localVideo.srcObject = null;
        isVideoOff = true;
        videoButton.innerHTML = '<i class="fas fa-video-slash"></i>';
        videoButton.classList.add('active');
    }
}

// Function to toggle microphone
function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            audioTracks[0].enabled = !isMuted;
        }
    }

    const muteButton = document.getElementById('mute-btn');
    if (isMuted) {
        muteButton.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        muteButton.classList.add('active');
    } else {
        muteButton.innerHTML = '<i class="fas fa-microphone"></i>';
        muteButton.classList.remove('active');
    }
}

// Share Screen Functionality
function shareScreen() {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(screenStream => {
        const screenVideo = document.createElement('video');
        screenVideo.srcObject = screenStream;
        screenVideo.autoplay = true;
        screenVideo.className = 'screen-video';
        screenVideo.style.border = '2px solid #28a745';
        addVideoStream(screenVideo, 'Screen Share');

        // Stop sharing when the user stops sharing the screen
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
    const message = chatInputField.value.trim();
    if (message !== "") {
        displayMessage({ user: name, text: message, own: true });
        chatInputField.value = "";
    }
}

// Display Chat Message
function displayMessage(message) {
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
    document.getElementById('chat-container').classList.toggle('visible');
}

// Toggle Participants Visibility
function toggleParticipants() {
    document.getElementById('participants-container').classList.toggle('visible');
}

// Leave Meeting Functionality
function leaveMeeting() {
    window.close(); // Closes the current window/tab
}

// Function to add participants to the list
function addParticipant(name) {
    const participant = document.createElement('p');
    participant.textContent = name;
    participantsList.appendChild(participant);
}

// Dummy Participants (Replace with backend data)
addParticipant('User One');
addParticipant('User Two');
addParticipant('User Three');

// Active Speaker Indicator (Requires backend integration)
function setActiveSpeaker(videoElement) {
    document.querySelectorAll('.video-container').forEach(vc => vc.classList.remove('active-speaker'));
    videoElement.parentElement.classList.add('active-speaker');
}
if (window.location.pathname.includes("meeting.html")) {
    // Now, only request the camera if the user is in a meeting
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById("large-video").srcObject = stream;
        } catch (error) {
            console.error("Error accessing camera:", error);
        }
    }
}