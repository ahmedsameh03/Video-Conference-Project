// public/js/meeting.js

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

// Update meeting ID and user name in the navbar and video
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('meeting-id-display').textContent = `#${room}`;
    document.getElementById('user-name-display').textContent = name;
});

// Get elements
const localVideo = document.getElementById('local-video');
const videoGrid = document.getElementById('video-grid');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const participantsList = document.getElementById('participants-list');

// Flags for mute and video
let isMuted = false;
let isVideoOff = false;

// Access user's camera and microphone
navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
}).then(stream => {
    // Display local video
    localVideo.srcObject = stream;
    localVideo.play();

    // Add local video to grid
    addVideoStream(localVideo, name);

    // Here you can add code to connect to other participants if backend is available
}).catch(error => {
    console.error('Error accessing media devices.', error);
    alert('Cannot access camera or microphone.');
});

// Function to add video stream to grid
function addVideoStream(video, username) {
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
    const audioTracks = localVideo.srcObject.getAudioTracks();
    if (audioTracks.length > 0) {
        audioTracks[0].enabled = !isMuted;
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

// Toggle Start/Stop Video
function toggleVideo() {
    isVideoOff = !isVideoOff;
    const videoTracks = localVideo.srcObject.getVideoTracks();
    if (videoTracks.length > 0) {
        videoTracks[0].enabled = !isVideoOff;
    }

    const videoButton = document.getElementById('video-btn');
    if (isVideoOff) {
        videoButton.innerHTML = '<i class="fas fa-video-slash"></i>';
        videoButton.classList.add('active');
    } else {
        videoButton.innerHTML = '<i class="fas fa-video"></i>';
        videoButton.classList.remove('active');
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

        // If you have a backend, you can add code to broadcast this screenStream to other participants

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
        // If you have a backend, you can add code to send the message to other participants
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
    const chatContainer = document.getElementById('chat-container');
    chatContainer.classList.toggle('visible');
}

// Toggle Participants Visibility
function toggleParticipants() {
    const participantsContainer = document.getElementById('participants-container');
    participantsContainer.classList.toggle('visible');
}

// Leave Meeting Functionality
function leaveMeeting() {
    // If you have a backend, you can add code to disconnect from the meeting
    window.close(); // Closes the current window/tab
}

// Function to add participants to the list (For demonstration purposes)
function addParticipant(name) {
    const participant = document.createElement('p');
    participant.textContent = name;
    participantsList.appendChild(participant);
}

// Adding dummy participants (Replace this with dynamic data when backend is connected)
addParticipant('User One');
addParticipant('User Two');
addParticipant('User Three');

// Active Speaker Indicator (Requires backend integration)
function setActiveSpeaker(videoElement) {
    // This function requires backend support to analyze audio streams and determine the active speaker
    // As a placeholder, we'll highlight the videoElement passed to this function
    document.querySelectorAll('.video-container').forEach(vc => vc.classList.remove('active-speaker'));
    videoElement.parentElement.classList.add('active-speaker');
}

// Example usage (Needs to be triggered by backend events)
// setActiveSpeaker(someVideoElement);
