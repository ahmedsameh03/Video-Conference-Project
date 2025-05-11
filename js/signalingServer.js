// signalingServer.js

const WebSocket = require('ws');
const PORT = process.env.PORT || 3001;

// In-memory room storage: { roomId: [ws1, ws2, …], … }
const rooms = {};

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`🚀 Signaling server listening on port ${PORT}`);
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('⚠️ Invalid JSON:', raw);
      return;
    }
    const { type, room, user, target, offer, answer, candidate } = data;

    // Utility: send a JSON message
    const send = (socket, msg) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    };

    switch (type) {
      case 'join':
        // Attach metadata
        ws.user = user;
        ws.room = room;

        // Add to room
        rooms[room] = rooms[room] || [];
        // First, tell the new user about existing peers
        rooms[room].forEach(existing => {
          send(ws, { type: 'new-user', user: existing.user });
        });
        // Then, add them to the room
        rooms[room].push(ws);
        // Notify everyone else that someone new arrived
        rooms[room].forEach(client => {
          if (client !== ws) {
            send(client, { type: 'new-user', user });
          }
        });
        break;

      case 'offer':
      case 'answer':
      case 'candidate':
        // Forward to the one peer matching `target`
        (rooms[room] || []).forEach(client => {
          if (client.user === target) {
            send(client, { type, user, offer, answer, candidate });
          }
        });
        break;

      case 'leave':
        // Remove and notify
        if (rooms[room]) {
          rooms[room] = rooms[room].filter(c => c !== ws);
          rooms[room].forEach(client => {
            send(client, { type: 'user-left', user });
          });
          if (rooms[room].length === 0) {
            delete rooms[room];
          }
        }
        break;

      default:
        console.warn('⚠️ Unhandled message type:', type);
    }
  });

  ws.on('close', () => {
    // Handle abrupt disconnect same as "leave"
    const { room, user } = ws;
    if (room && rooms[room]) {
      rooms[room] = rooms[room].filter(c => c !== ws);
      rooms[room].forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'user-left', user }));
        }
      });
      if (rooms[room].length === 0) {
        delete rooms[room];
      }
    }
  });
});
