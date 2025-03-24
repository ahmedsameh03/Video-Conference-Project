const WebSocket = require("ws");

const PORT = process.env.PORT || 4000;
const server = new WebSocket.Server({ port: PORT });
const rooms = {}; // Store active rooms and participants

console.log(`✅ WebRTC Signaling Server running on ws://localhost:${PORT}`);

server.on("connection", (ws) => {
    console.log("🔗 New WebSocket connection established");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case "join":
                    if (!rooms[data.room]) {
                        rooms[data.room] = [];
                    }

                    rooms[data.room].push(ws);
                    ws.room = data.room;
                    ws.user = data.user; // Store user info

                    // Notify existing users in the room
                    rooms[data.room].forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: "new-user", user: data.user }));
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
            console.error("❌ Error parsing message:", error);
        }
    });

    ws.on("close", () => {
        removeUserFromRoom(ws);
    });

    function removeUserFromRoom(ws) {
        if (ws.room && rooms[ws.room]) {
            rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);

            // Notify remaining users in the room
            rooms[ws.room].forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: "user-left", user: ws.user }));
                }
            });

            // Delete room if empty
            if (rooms[ws.room].length === 0) {
                delete rooms[ws.room];
            }

            console.log(`🔴 User "${ws.user}" left room: ${ws.room}`);
        }
    }
});

console.log(`WebSocket server running on port ${PORT}`);
