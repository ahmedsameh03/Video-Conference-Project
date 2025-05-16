const WebSocket = require("ws");

const PORT = process.env.PORT || 3001;
const server = new WebSocket.Server({ port: PORT });
const rooms = {};

console.log(`✅ WebRTC Signaling Server running on ws://localhost:${PORT}`);

server.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (origin !== "https://seenmeet.vercel.app" && origin !== "http://localhost:3000") {
    ws.close(1008, "Unauthorized origin");
    console.warn(`🚫 Connection rejected from unauthorized origin: ${origin}`);
    return;
  }
  console.log("🔗 New WebSocket connection established from", origin);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (!data.type || !data.room) {
        console.warn("⚠️ Invalid message received: Missing type or room");
        return;
      }

      // Ensure the room exists
      if (!rooms[data.room]) rooms[data.room] = [];

      // Assign the user to the WebSocket
      if (data.user) ws.user = data.user;

      switch (data.type) {
        case "join":
          // Add the user to the room if not already present
          if (!rooms[data.room].includes(ws)) {
            rooms[data.room].push(ws);
            ws.room = data.room;
            ws.user = data.user || `User-${Math.floor(Math.random() * 1000)}`;
            console.log(`👤 ${ws.user} joined room "${ws.room}". Total: ${rooms[ws.room].length}`);
          }

          // Send the new user the list of existing users
          const existingUsers = rooms[data.room]
            .filter(client => client !== ws && client.readyState === WebSocket.OPEN)
            .map(client => client.user);
          ws.send(JSON.stringify({ type: "users-in-room", users: existingUsers }));

          // Notify others of the new user
          broadcast(ws, data.room, { type: "new-user", user: ws.user });
          break;

        case "offer":
          sendToUser(data.userTo, data.room, {
            type: "offer",
            offer: data.offer,
            user: ws.user,
            room: data.room
          });
          break;

        case "answer":
          sendToUser(data.userTo, data.room, {
            type: "answer",
            answer: data.answer,
            user: ws.user,
            room: data.room
          });
          break;

        case "candidate":
          sendToUser(data.userTo, data.room, {
            type: "candidate",
            candidate: data.candidate,
            user: ws.user,
            room: data.room
          });
          break;

        case "chat":
          broadcast(ws, data.room, { type: "chat", user: ws.user, text: data.text, room: data.room });
          break;

        case "leave":
          removeUserFromRoom(ws);
          break;

        default:
          console.warn(`⚠️ Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("❌ Error processing message:", error.message, error.stack);
    }
  });

  ws.on("close", () => {
    removeUserFromRoom(ws);
  });

  ws.on("error", (error) => {
    console.error("⚠️ WebSocket error:", error.message, error.stack);
  });

  // Broadcast to everyone in the room except the sender
  function broadcast(sender, room, data) {
    const clients = rooms[room] || [];
    clients.forEach(client => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  // Send a message to a specific user in the room
  function sendToUser(user, room, data) {
    const clients = rooms[room] || [];
    const target = clients.find(client => client.user === user && client.readyState === WebSocket.OPEN);
    if (target) {
      target.send(JSON.stringify(data));
      console.log(`📤 Sent "${data.type}" from ${data.user} to ${user} in room "${room}"`);
    } else {
      console.warn(`⚠️ User "${user}" not found in room "${room}"`);
    }
  }

  function removeUserFromRoom(ws) {
    if (!ws.room || !rooms[ws.room]) return;
    rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
    console.log(`🔴 ${ws.user} left room "${ws.room}". Remaining: ${rooms[ws.room].length}`);
    broadcast(ws, ws.room, { type: "user-left", user: ws.user });
    if (rooms[ws.room].length === 0) {
      delete rooms[ws.room];
    }
  }
});

server.on("listening", () => {
  console.log(`✅ WebSocket Server is running on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("❌ WebSocket Server Error:", err.message, err.stack);
});