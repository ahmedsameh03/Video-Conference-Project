// public/js/dashboard.js

// Function to generate a random Meeting ID
function generateMeetingID() {
    return Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Handle Create Meeting Form Submission
document.getElementById('create-meeting-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const userName = document.getElementById('create-user-name').value.trim();
    if (userName) {
        const meetingID = generateMeetingID();
        // Redirect to meeting.html with room ID and user name as URL parameters
        window.location.href = `meeting.html?room=${meetingID}&name=${encodeURIComponent(userName)}`;
    }
});

// Handle Join Meeting Form Submission
document.getElementById('join-meeting-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const userName = document.getElementById('join-user-name').value.trim();
    const meetingID = document.getElementById('meeting-id').value.trim();
    if (userName && meetingID) {
        // Redirect to meeting.html with room ID and user name as URL parameters
        window.location.href = `meeting.html?room=${meetingID}&name=${encodeURIComponent(userName)}`;
    }
});

// Function to generate a random Meeting ID
function generateMeetingID() {
    return Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Ensure no camera access on the dashboard
async function stopCameraOnDashboard() {
    if (window.location.pathname.includes("dashboard.html")) {
        console.log("Stopping any active camera streams...");
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = mediaDevices.filter(device => device.kind === "videoinput");

        if (videoDevices.length > 0) {
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                stream.getTracks().forEach(track => track.stop()); // Stop all video tracks
            }).catch(err => console.warn("No active camera to stop.", err));
        }
    }
}

// Run this function on page load
document.addEventListener("DOMContentLoaded", stopCameraOnDashboard);

// Handle Create Meeting Form Submission
document.getElementById('create-meeting-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const userName = document.getElementById('create-user-name').value.trim();
    if (userName) {
        const meetingID = generateMeetingID();
        window.location.href = `meeting.html?room=${meetingID}&name=${encodeURIComponent(userName)}`;
    }
});

// Handle Join Meeting Form Submission
document.getElementById('join-meeting-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const userName = document.getElementById('join-user-name').value.trim();
    const meetingID = document.getElementById('meeting-id').value.trim();
    if (userName && meetingID) {
        window.location.href = `meeting.html?room=${meetingID}&name=${encodeURIComponent(userName)}`;
    }
});

