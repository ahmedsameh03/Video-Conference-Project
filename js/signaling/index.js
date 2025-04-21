const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = 5000;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, userId }) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-connected', userId);
    console.log(`${userId} joined room ${roomId}`);

    socket.on('offer', (data) => {
      socket.to(roomId).emit('offer', data);
    });

    socket.on('answer', (data) => {
      socket.to(roomId).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
      socket.to(roomId).emit('ice-candidate', data);
    });

    socket.on('disconnect', () => {
      socket.to(roomId).emit('user-disconnected', userId);
      console.log(`${userId} disconnected from ${roomId}`);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server running at http://localhost:${PORT}`);
});
