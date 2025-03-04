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
