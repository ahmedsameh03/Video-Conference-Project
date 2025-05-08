const express = require('express');
const path = require('path');
const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 8000; // HTTP server port

const projectRoot = __dirname; // server.js is in Video-Conference-Project-main

// Serve static files from the project root
app.use(express.static(projectRoot));
app.use('/js', express.static(path.join(projectRoot, 'js')));
app.use('/css', express.static(path.join(projectRoot, 'css')));
app.use('/images', express.static(path.join(projectRoot, 'images')));


// Route for the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

// Route for the meeting page
app.get('/meeting.html', (req, res) => {
    res.sendFile(path.join(projectRoot, 'meeting.html'));
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`✅ HTTP Server running on http://0.0.0.0:${HTTP_PORT}`);
    console.log(`Access meeting via http://<your_ip>:${HTTP_PORT}/meeting.html?room=test&name=user1`);
});

