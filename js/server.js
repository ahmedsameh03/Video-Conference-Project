const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3000 });
const rooms = {}; // Store active rooms and participants

wss.on("connection", (ws) => {
    console.log("🔗 New WebSocket connection established");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case "join":
                    if (!rooms[data.room]) rooms[data.room] = [];
                    rooms[data.room].push(ws);
                    ws.room = data.room;

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
                    if (rooms[data.room]) {
                        rooms[data.room] = rooms[data.room].filter(client => client !== ws);
                        rooms[data.room].forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: "user-left", user: data.user }));
                            }
                        });
                    }
                    break;
            }
        } catch (error) {
            console.error(" Error parsing message:", error);
        }
    });

    ws.on("close", () => {
        if (ws.room && rooms[ws.room]) {
            rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
            console.log(` User disconnected from room: ${ws.room}`);
        }
    });
});

console.log("✅ WebRTC Signaling Server running on ws://localhost:3000");
