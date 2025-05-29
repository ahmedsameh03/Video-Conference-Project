const WebSocket = require("ws");

const PORT = process.env.PORT || 3001;
const server = new WebSocket.Server({ port: PORT });
const rooms = {};

server.on("connection", (ws, req) => {
  const origin = req.headers.origin || "";
  const allowedOrigins = [
    "https://seenmeet.vercel.app",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ];

  if (!allowedOrigins.includes(origin)) {
    ws.close(1008, "Unauthorized origin");
    console.warn(`Connection rejected from unauthorized origin: ${origin}`);
    return;
  }

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      const allowedTypes = ["join", "offer", "answer", "candidate", "chat", "leave"];
      if (!allowedTypes.includes(data.type)) {
        console.warn(`Rejected unknown message type: ${data.type}`);
        return;
      }

      if (!data.type || !data.room) {
        console.warn(`Invalid message: missing type or room`);
        return;
      }

      if (!rooms[data.room]) rooms[data.room] = [];

      switch (data.type) {
        case "join":
          if (!rooms[data.room].includes(ws)) {
            rooms[data.room].push(ws);
          }
          ws.room = data.room;
          ws.user = data.user || `User-${Math.floor(Math.random() * 1000)}`;

          const existingUsers = rooms[data.room]
            .filter(client => client !== ws && client.readyState === WebSocket.OPEN)
            .map(client => client.user);
          existingUsers.forEach(user => {
            try {
              ws.send(JSON.stringify({ type: "new-user", user }));
            } catch (e) {
              console.error(`Failed to send new-user to ${ws.user}:`, e);
            }
          });

          broadcast(ws, data.room, { type: "new-user", user: ws.user });
          break;

        case "offer":
          broadcast(ws, data.room, {
            type: "offer",
            offer: data.offer,
            user: ws.user,
            room: data.room,
          });
          break;

        case "answer":
          broadcast(ws, data.room, {
            type: "answer",
            answer: data.answer,
            user: ws.user,
            room: data.room,
          });
          break;

        case "candidate":
          broadcast(ws, data.room, {
            type: "candidate",
            candidate: data.candidate,
            user: ws.user,
            room: data.room,
          });
          break;

        case "chat":
          broadcast(ws, data.room, {
            type: "chat",
            user: ws.user,
            text: data.text,
            room: data.room,
          });
          break;

        case "leave":
          removeUserFromRoom(ws);
          break;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    removeUserFromRoom(ws);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    removeUserFromRoom(ws);
  });
});

function broadcast(sender, room, data) {
  const clients = rooms[room] || [];
  clients.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error(`Failed to send ${data.type} to ${client.user || 'unknown'}:`, error);
        client.close(1001, "Failed to send message");
      }
    }
  });
}

function removeUserFromRoom(ws) {
  if (!ws.room || !rooms[ws.room]) return;
  rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
  broadcast(ws, ws.room, { type: "user-left", user: ws.user });
  if (rooms[ws.room].length === 0) {
    delete rooms[ws.room];
  }
}

const interval = setInterval(() => {
  server.clients.forEach(ws => {
    if (!ws.isAlive) {
      console.warn(`Client ${ws.user || 'unknown'} is unresponsive, closing connection`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.on("close", () => {
  clearInterval(interval);
});

server.on("listening", () => {
  console.log(`WebSocket Server is running on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("WebSocket Server Error:", err);
});
