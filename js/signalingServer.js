const WebSocket = require("ws");

const PORT = process.env.PORT || 3001;
const server = new WebSocket.Server({ port: PORT });
const rooms = {};

console.log(`✅ WebRTC Signaling Server running on ws://localhost:${PORT}`);

// ✅ WebSocket connection handler
server.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "http://localhost:5500",
    "https://seenmeet.vercel.app",
  ];
  if (!allowedOrigins.includes(origin)) {
    ws.close(1008, "Unauthorized origin");
    console.warn(`🚫 Connection rejected from unauthorized origin: ${origin}`);
    return;
  }

  console.log("🔗 New WebSocket connection established from", origin);

  // ✅ Handle incoming WebSocket messages
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message); // ✅ parse before using it

      const allowedTypes = [
        "join",
        "offer",
        "answer",
        "candidate",
        "chat",
        "leave",
        "e2ee-verification",
      ];
      if (!allowedTypes.includes(data.type)) {
        console.warn(`❌ Rejected unknown message type: ${data.type}`);
        return;
      }

      if (!data.type || !data.room) return;

      if (!rooms[data.room]) rooms[data.room] = [];

      console.log(
        `📩 Received message of type "${data.type}" in room "${
          data.room
        }" from ${ws.user || "unknown"}`
      );

      switch (data.type) {
        case "join":
          if (!rooms[data.room].includes(ws)) {
            rooms[data.room].push(ws);
          }
          ws.room = data.room;
          ws.user = data.user || `User-${Math.floor(Math.random() * 1000)}`;
          ws.publicKey = data.publicKey;
          console.log(
            `👤 ${ws.user} joined room "${ws.room}". Total participants: ${
              rooms[ws.room].length
            }`
          );

          // Send existing users (with publicKey) to new user
          const existingUsers = rooms[data.room].filter(
            (client) => client !== ws && client.readyState === WebSocket.OPEN
          );
          existingUsers.forEach((client) => {
            ws.send(
              JSON.stringify({
                type: "new-user",
                user: client.user,
                publicKey: client.publicKey,
              })
            );
          });

          // Notify others about the new user (with public key)
          const joinData = { type: "new-user", user: ws.user };
          if (data.publicKey) {
            joinData.publicKey = data.publicKey;
            console.log(`🔐 ${ws.user} joined with E2EE public key`);
          }
          broadcast(ws, data.room, joinData);
          break;

        case "offer":
        case "answer":
        case "candidate": {
          // Only send to the intended recipient
          const targetClient = rooms[data.room].find(
            (client) =>
              client.user === data.toUser &&
              client.readyState === WebSocket.OPEN
          );
          if (targetClient) {
            targetClient.send(
              JSON.stringify({
                ...data,
                fromUser: ws.user, // Add sender info
              })
            );
          }
          break;
        }

        case "chat":
          broadcast(ws, data.room, {
            type: "chat",
            user: ws.user,
            text: data.text,
            room: data.room,
          });
          break;

        case "e2ee-verification":
          // Forward verification message to specific user or broadcast
          if (data.targetUser) {
            // Send to specific user
            const targetClient = rooms[data.room].find(
              (client) =>
                client.user === data.targetUser &&
                client.readyState === WebSocket.OPEN
            );
            if (targetClient) {
              targetClient.send(
                JSON.stringify({
                  type: "e2ee-verification",
                  user: ws.user,
                  code: data.code,
                  room: data.room,
                })
              );
              console.log(
                `🔐 E2EE verification sent from ${ws.user} to ${data.targetUser}`
              );
            }
          } else {
            // Broadcast to all users in room
            broadcast(ws, data.room, {
              type: "e2ee-verification",
              user: ws.user,
              code: data.code,
              room: data.room,
            });
          }
          break;

        case "leave":
          removeUserFromRoom(ws);
          break;
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

  function broadcast(sender, room, data) {
    const clients = rooms[room] || [];
    console.log(
      `📢 Broadcasting to ${clients.length - 1} clients in room "${room}"`
    );
    clients.forEach((client) => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  function removeUserFromRoom(ws) {
    if (!ws.room || !rooms[ws.room]) return;

    rooms[ws.room] = rooms[ws.room].filter((client) => client !== ws);
    console.log(
      `🔴 ${ws.user} left room "${ws.room}". Remaining: ${
        rooms[ws.room].length
      }`
    );

    broadcast(ws, ws.room, { type: "user-left", user: ws.user });

    if (rooms[ws.room].length === 0) {
      delete rooms[ws.room];
    }
  }
});

// ✅ Server startup logging
server.on("listening", () => {
  console.log(`✅ WebSocket Server is running on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("❌ WebSocket Server Error:", err);
});
