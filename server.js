const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store meeting rooms and participants
const rooms = {};

// Home page
app.get('/', (req, res) => {
  res.render('index');
});

// Join page
app.get('/join', (req, res) => {
  const { email = 'guest', code } = req.query;
  if (code) {
    if (!/^[a-zA-Z0-9-]{6,36}$/.test(code)) {
      console.log(`Invalid calling ID: ${code}`);
      res.render('join', { error: 'Invalid meeting code. Use 6-36 alphanumeric characters or hyphens.' });
    } else {
      if (!rooms[code]) {
        rooms[code] = { participants: [] };
        console.log(`Created room: ${code}`);
      }
      console.log(`User ${email} joining room: ${code}`);
      res.render('meeting', { email, roomId: code });
    }
  } else {
    res.render('join', { error: req.query.code ? 'Invalid meeting code.' : null });
  }
});

// Join page with URL parameters
app.get('/join/:email/:code', (req, res) => {
  const { email, code } = req.params;
  if (!/^[a-zA-Z0-9-]{6,36}$/.test(code)) {
    console.log(`Invalid calling ID: ${code}`);
    res.render('join', { error: 'Invalid meeting code. Use 6-36 alphanumeric characters or hyphens.' });
  } else {
    if (!rooms[code]) {
      rooms[code] = { participants: [] };
      console.log(`Created room: ${code}`);
    }
    console.log(`User ${email} joining room: ${code}`);
    res.render('meeting', { email, roomId: code });
  }
});

// Create a new meeting
app.get('/create', (req, res) => {
  const roomId = uuidv4();
  rooms[roomId] = { participants: [] };
  console.log(`Created new meeting: ${roomId}`);
  res.redirect(`/join/guest/${roomId}`);
});

// WebSocket signaling
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, email }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { participants: [] };
    }
    rooms[roomId].participants.push({ id: socket.id, email });
    console.log(`User ${email} joined room: ${roomId}`);
    socket.to(roomId).emit('user-connected', { id: socket.id, email });

    socket.on('offer', (payload) => {
      io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
      io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
      io.to(payload.target).emit('ice-candidate', payload);
    });

    socket.on('chat-message', (message) => {
      io.to(roomId).emit('chat-message', { email, message });
    });

    socket.on('disconnect', () => {
      rooms[roomId].participants = rooms[roomId].participants.filter(p => p.id !== socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
      console.log(`User ${email} left room: ${roomId}`);
    });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});