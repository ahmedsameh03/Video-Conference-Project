const WebSocket = require("ws");

const PORT = process.env.PORT || 3001;
const server = new WebSocket.Server({ port: PORT });
const rooms = {};

console.log(`✅ WebRTC Signaling Server running on ws://localhost:${PORT}`);

server.on("connection", (ws) => {
    console.log("🔗 New WebSocket connection established");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            if (!data.type || !data.room) return;

            switch (data.type) {
                case "join":
                    if (!rooms[data.room]) {
                        rooms[data.room] = [];
                    }
                    rooms[data.room].push(ws);
                    ws.room = data.room;
                    ws.user = data.user || `User-${Math.floor(Math.random() * 1000)}`;

                    console.log(`👤 ${ws.user} joined room: ${ws.room}`);

                    rooms[data.room].forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: "new-user", user: ws.user }));
                        }
                    });
                    break;

                case "offer":
                case "answer":
                case "candidate":
                    rooms[data.room]?.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(data));
                        }
                    });
                    break;

                case "leave":
                    removeUserFromRoom(ws);
                    break;

                default:
                    console.warn(`⚠️ Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error("❌ Error processing message:", error);
        }
    });

    ws.on("close", () => {
        removeUserFromRoom(ws);
    });

    ws.on("error", (error) => {
        console.error("⚠️ WebSocket error:", error);
    });

    function removeUserFromRoom(ws) {
        if (!ws.room || !rooms[ws.room]) return;

        rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);

        rooms[ws.room].forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "user-left", user: ws.user }));
            }
        });

        if (rooms[ws.room].length === 0) {
            delete rooms[ws.room];
        }

        console.log(`🔴 ${ws.user} left room: ${ws.room}`);
    }
});

server.on("listening", () => {
    console.log(`✅ WebSocket Server is running on port ${PORT}`);
});

server.on("error", (err) => {
    console.error("❌ WebSocket Server Error:", err);
});
