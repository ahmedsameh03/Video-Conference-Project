// public/js/main.js

// Function to parse URL parameters
function getQueryParams() {
  const params = {};
  window.location.search.replace(
    /[?&]+([^=&]+)=([^&]*)/gi,
    function (str, key, value) {
      params[key] = decodeURIComponent(value);
    }
  );
  return params;
}

// Extract room ID and user name from URL
const { room, name } = getQueryParams();
if (!room || !name) {
  alert(
    "Room ID and Name are required in the URL parameters. E.g., ?room=myroom&name=MyName"
  );
  // Optionally redirect to a page where they can enter these details
  // window.location.href = "/";
}

// Get essential DOM elements
const localVideo = document.getElementById("local-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");
const chatContainer = document.getElementById("chat-container");
const participantsContainer = document.getElementById("participants-container");

let localStream;
let isMuted = false;
let isVideoOff = false;
const peerConnections = {}; // Store peer connections, keyed by user ID
let ws;

// STUN/TURN servers - using XirSys TURN service
const iceServers = {
  iceServers: [
    { urls: ["stun:fr-turn4.xirsys.com"] },
    {
      username:
        "cUZOpdVWEBLF0Ut185izT8u2FICM65KXzn0Ymd32wTTRc-6Is4Y6oPKrjrwX7u_TAAAAAGhWRYBTRUVOR1A0",
      credential: "0f963c80-4e62-11f0-87f7-d2ba3806b5d3",
      urls: [
        "turn:fr-turn4.xirsys.com:80?transport=udp",
        "turn:fr-turn4.xirsys.com:3478?transport=udp",
        "turn:fr-turn4.xirsys.com:80?transport=tcp",
        "turn:fr-turn4.xirsys.com:3478?transport=tcp",
        "turns:fr-turn4.xirsys.com:443?transport=tcp",
        "turns:fr-turn4.xirsys.com:5349?transport=tcp",
      ],
    },
  ],
};

// Determine WebSocket URL
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
// Assuming signaling server runs on the same host, but on port 3001 or a port defined by environment for Railway
// For local development, if server is on 3001 and client on different port (e.g. live server), specify 3001.
// For Railway, it might be on the same port or a different one, often the same if proxied.
// The signalingServer.js uses process.env.PORT || 3001. If Railway exposes on a specific port, use that.
// For simplicity, let's assume it's on the same host and port as the HTTP server if deployed, or 3001 locally.
// This might need adjustment based on the actual Railway deployment configuration.
// A common pattern for Railway is that the WebSocket server runs on the same port as the HTTP server.
// If server2.js (Express) serves static files and signalingServer.js (WS) runs on a different port, this needs to be accurate.
// The provided start script is `node js/signalingServer.js`. Let's assume it's on port 3001 for now.
// For a robust solution, the client should know the correct signaling server URL.
// Let's try to make it configurable or intelligent.
// If the app is served from server2.js, and signalingServer.js is separate, we need to define the port.
// For now, hardcoding to 3001 for local, but this is a potential point of failure in deployment.
// A better way would be to have the Express server provide this info or use a relative path if possible.
const wsURL = `${wsProtocol}//${window.location.hostname}:3001`; // This assumes signaling server is on port 3001.
// If Railway maps the WebSocket to the same port as HTTP, then window.location.host should be used without :3001
// const wsURL = `${wsProtocol}//${window.location.host}`;

document.addEventListener("DOMContentLoaded", () => {
  const meetingIdDisplay = document.getElementById("meeting-id-display");
  const userNameDisplay = document.getElementById("user-name-display");

  if (meetingIdDisplay) meetingIdDisplay.textContent = `#${room}`;
  if (userNameDisplay) userNameDisplay.textContent = name;

  init();

  const leaveBtn = document.getElementById("leave-btn");
  if (leaveBtn) leaveBtn.addEventListener("click", leaveMeeting);

  const muteBtn = document.getElementById("mute-btn");
  if (muteBtn) muteBtn.addEventListener("click", toggleMute);

  const videoBtn = document.getElementById("video-btn");
  if (videoBtn) videoBtn.addEventListener("click", toggleVideo);

  const screenShareBtn = document.getElementById("screen-share-btn");
  if (screenShareBtn) screenShareBtn.addEventListener("click", shareScreen);

  const sendChatBtn = document.getElementById("send-chat-btn"); // Assuming a send button for chat
  if (sendChatBtn) sendChatBtn.addEventListener("click", sendMessage);
  if (chatInputField)
    chatInputField.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendMessage();
    });

  const toggleChatBtn = document.getElementById("toggle-chat-btn");
  if (toggleChatBtn) toggleChatBtn.addEventListener("click", toggleChat);

  const toggleParticipantsBtn = document.getElementById(
    "toggle-participants-btn"
  );
  if (toggleParticipantsBtn)
    toggleParticipantsBtn.addEventListener("click", toggleParticipants);
});

async function init() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true; // Mute local video to avoid echo
      addVideoStreamElement(localVideo, name, true); // isLocal = true
    } else {
      console.error("Error: local-video element not found!");
    }
    updateParticipantList(name, true); // Add self to participant list
    connectWebSocket();
  } catch (error) {
    console.error("Error accessing media devices or initializing.", error);
    alert("Could not access camera and microphone. Please check permissions.");
  }
}

function connectWebSocket() {
  ws = new WebSocket(wsURL);

  ws.onopen = () => {
    console.log("✅ WebSocket connection established");
    ws.send(JSON.stringify({ type: "join", room: room, user: name }));
  };

  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    console.log("Received message:", data);
    switch (data.type) {
      case "new-user": // Another user joined
        handleNewUser(data.user);
        break;
      case "offer":
        handleOffer(data.offer, data.fromUser);
        break;
      case "answer":
        handleAnswer(data.answer, data.fromUser);
        break;
      case "candidate":
        handleCandidate(data.candidate, data.fromUser);
        break;
      case "user-left":
        handleUserLeft(data.user);
        break;
      case "chat-message": // Handle incoming chat messages
        displayMessage({ user: data.user, text: data.text, own: false });
        break;
      default:
        console.warn(`⚠️ Unknown message type: ${data.type}`);
    }
  };

  ws.onclose = () => {
    console.log("❌ WebSocket connection closed");
    // Optionally, try to reconnect or notify user
  };

  ws.onerror = (error) => {
    console.error(" WebSocket error:", error);
    alert("WebSocket connection error. Please try refreshing the page.");
  };
}

function createPeerConnection(userToSignal) {
  if (peerConnections[userToSignal]) {
    console.log(`Peer connection already exists for ${userToSignal}`);
    return peerConnections[userToSignal];
  }

  const pc = new RTCPeerConnection(iceServers);
  peerConnections[userToSignal] = pc;
  console.log(`Creating peer connection for ${userToSignal}`);

  // Add local tracks to the peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
          room: room,
          toUser: userToSignal,
          fromUser: name,
        })
      );
    }
  };

  pc.ontrack = (event) => {
    console.log(`Received remote track from ${userToSignal}`);
    const remoteVideo = document.createElement("video");
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.autoplay = true;
    remoteVideo.playsinline = true;
    addVideoStreamElement(remoteVideo, userToSignal);
  };

  pc.oniceconnectionstatechange = () => {
    console.log(
      `ICE connection state for ${userToSignal}: ${pc.iceConnectionState}`
    );
    if (
      pc.iceConnectionState === "failed" ||
      pc.iceConnectionState === "disconnected" ||
      pc.iceConnectionState === "closed"
    ) {
      // Handle cleanup if connection fails or closes unexpectedly
      // removeVideoStreamElement(userToSignal);
      // delete peerConnections[userToSignal];
    }
  };

  updateParticipantList(userToSignal, true); // Add new user to participant list

  return pc;
}

async function handleNewUser(newUser) {
  console.log(`${newUser} joined the room. Creating offer...`);
  const pc = createPeerConnection(newUser);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(
      JSON.stringify({
        type: "offer",
        offer: offer,
        room: room,
        toUser: newUser,
        fromUser: name,
      })
    );
  } catch (error) {
    console.error("Error creating offer:", error);
  }
}

async function handleOffer(offer, fromUser) {
  console.log(`Received offer from ${fromUser}. Creating answer...`);
  const pc = createPeerConnection(fromUser);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(
      JSON.stringify({
        type: "answer",
        answer: answer,
        room: room,
        toUser: fromUser,
        fromUser: name,
      })
    );
  } catch (error) {
    console.error("Error handling offer:", error);
  }
}

async function handleAnswer(answer, fromUser) {
  console.log(`Received answer from ${fromUser}.`);
  const pc = peerConnections[fromUser];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  } else {
    console.error(`No peer connection found for ${fromUser} to handle answer.`);
  }
}

async function handleCandidate(candidate, fromUser) {
  console.log(`Received ICE candidate from ${fromUser}.`);
  const pc = peerConnections[fromUser];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
    }
  } else {
    console.error(
      `No peer connection found for ${fromUser} to add ICE candidate.`
    );
  }
}

function handleUserLeft(user) {
  console.log(`${user} left the room.`);
  if (peerConnections[user]) {
    peerConnections[user].close();
    delete peerConnections[user];
  }
  removeVideoStreamElement(user);
  updateParticipantList(user, false); // Remove user from participant list
}

function addVideoStreamElement(videoElement, username, isLocal = false) {
  if (!videoGrid) {
    console.error("Error: video-grid element not found!");
    return;
  }

  // Remove existing video for this user if it exists to prevent duplicates
  const existingContainer = document.getElementById(
    `video-container-${username}`
  );
  if (existingContainer) {
    existingContainer.remove();
  }

  const videoContainer = document.createElement("div");
  videoContainer.id = `video-container-${username}`;
  videoContainer.classList.add("video-container");
  if (isLocal) {
    videoContainer.classList.add("local");
    videoElement.id = "local-video"; // Ensure local video has its ID
  }

  videoElement.classList.add("user-video");
  videoContainer.appendChild(videoElement);

  const nameTag = document.createElement("p");
  nameTag.classList.add("username-tag");
  nameTag.textContent = username + (isLocal ? " (You)" : "");
  videoContainer.appendChild(nameTag);

  videoGrid.appendChild(videoContainer);
}

function removeVideoStreamElement(username) {
  const videoContainer = document.getElementById(`video-container-${username}`);
  if (videoContainer) {
    videoContainer.remove();
  }
}

function updateParticipantList(username, isJoining) {
  if (!participantsList) return;

  if (isJoining) {
    if (!document.getElementById(`participant-${username}`)) {
      const participantElement = document.createElement("p");
      participantElement.id = `participant-${username}`;
      participantElement.textContent = username;
      participantsList.appendChild(participantElement);
    }
  } else {
    const participantElement = document.getElementById(
      `participant-${username}`
    );
    if (participantElement) {
      participantElement.remove();
    }
  }
}

// Toggle Mute/Unmute Microphone
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((track) => (track.enabled = !isMuted));

  const muteButton = document.getElementById("mute-btn");
  if (muteButton) {
    muteButton.innerHTML = isMuted
      ? '<i class="fas fa-microphone-slash"></i>'
      : '<i class="fas fa-microphone"></i>';
    muteButton.classList.toggle("active", isMuted);
  }
}

// Toggle Start/Stop Video
function toggleVideo() {
  if (!localStream) return;
  isVideoOff = !isVideoOff;
  localStream
    .getVideoTracks()
    .forEach((track) => (track.enabled = !isVideoOff));

  const videoButton = document.getElementById("video-btn");
  if (videoButton) {
    videoButton.innerHTML = isVideoOff
      ? '<i class="fas fa-video-slash"></i>'
      : '<i class="fas fa-video"></i>';
    videoButton.classList.toggle("active", isVideoOff);
  }
}

// Share Screen Functionality
async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const screenTrack = screenStream.getVideoTracks()[0];

    // Replace video track in existing peer connections
    for (const user in peerConnections) {
      const pc = peerConnections[user];
      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(screenTrack);
      }
    }

    // Update local video to show screen share
    if (localVideo) {
      localVideo.srcObject = screenStream;
    }

    screenTrack.onended = () => {
      // Revert to camera stream
      localStream.getVideoTracks().forEach((track) => {
        if (localVideo) localVideo.srcObject = localStream; // Revert local display
        for (const user in peerConnections) {
          const pc = peerConnections[user];
          const sender = pc
            .getSenders()
            .find((s) => s.track && s.track.kind === "video");
          if (sender) {
            sender.replaceTrack(track); // Revert for remote peers
          }
        }
      });
    };
  } catch (error) {
    console.error("Error sharing screen:", error);
  }
}

// Send Chat Message
function sendMessage() {
  const messageText = chatInputField?.value.trim();
  if (messageText && ws && ws.readyState === WebSocket.OPEN) {
    const messagePayload = {
      type: "chat-message",
      room: room,
      user: name,
      text: messageText,
    };
    ws.send(JSON.stringify(messagePayload));
    displayMessage({ user: name, text: messageText, own: true }); // Display own message locally
    if (chatInputField) chatInputField.value = "";
  }
}

// Display Chat Message
function displayMessage(message) {
  if (!chatMessages) {
    console.error("Error: chat-messages element not found!");
    return;
  }
  const messageElement = document.createElement("p");
  messageElement.innerHTML = `<strong>${message.user}${
    message.own ? " (You)" : ""
  }:</strong> ${message.text}`;
  if (message.own) {
    messageElement.classList.add("own-message");
  }
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Toggle Chat Visibility
function toggleChat() {
  if (chatContainer) chatContainer.classList.toggle("visible");
}

// Toggle Participants Visibility
function toggleParticipants() {
  if (participantsContainer) participantsContainer.classList.toggle("visible");
}

function leaveMeeting() {
  console.log("Leaving meeting...");
  if (ws) {
    ws.send(JSON.stringify({ type: "leave", room: room, user: name }));
    ws.close();
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  for (const user in peerConnections) {
    if (peerConnections[user]) {
      peerConnections[user].close();
    }
  }
  peerConnections = {};
  if (videoGrid) videoGrid.innerHTML = ""; // Clear video grid
  if (participantsList) participantsList.innerHTML = ""; // Clear participants list
  // Redirect or update UI to show left state
  alert("You have left the meeting.");
  window.location.href = "index.html"; // Or some other appropriate page
}

// Dummy addParticipant and setActiveSpeaker from original - replaced by updateParticipantList
// and WebRTC based active speaker detection would be more complex.
