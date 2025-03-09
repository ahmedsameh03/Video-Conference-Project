const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3000 });
const rooms = {}; // Store active rooms and participants

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case "join":
                if (!rooms[data.room]) rooms[data.room] = [];
                rooms[data.room].push(ws);
                ws.room = data.room;

                rooms[data.room].forEach(client => {
                    if (client !== ws) {
                        client.send(JSON.stringify({ type: "new-user", user: data.user }));
                    }
                });
                break;

            case "offer":
            case "answer":
            case "candidate":
                rooms[data.room]?.forEach(client => {
                    if (client !== ws) {
                        client.send(JSON.stringify(data));
                    }
                });
                break;

            case "leave":
                rooms[data.room] = rooms[data.room]?.filter(client => client !== ws);
                rooms[data.room]?.forEach(client => {
                    client.send(JSON.stringify({ type: "user-left", user: data.user }));
                });
                break;
        }
    });

    ws.on("close", () => {
        if (ws.room) {
            rooms[ws.room] = rooms[ws.room]?.filter(client => client !== ws);
        }
    });
});
socket.on("user-disconnected", (userId) => {
    if (peers[userId]) {
        peers[userId].close();  // Close the connection
        delete peers[userId];   // Remove from the list
        document.getElementById(userId)?.remove(); // Remove video tile
    }
});


console.log("✅ WebRTC Signaling Server running on ws://localhost:3000");
