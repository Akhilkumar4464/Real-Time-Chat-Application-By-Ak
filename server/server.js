import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { 
  initDb, 
  createUser, 
  getUserByUsername, 
  getUserById, 
  getAllUsers, 
  getRoomsForUser, 
  getMessagesForRoom, 
  getOrCreateDirectRoom, 
  saveMessage, 
  getMessageById 
} from './db.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // For development, allow all origins
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'chat_secret_token_12345';

// Middleware
app.use(cors());
app.use(express.json());

// Auth Middleware for Express API
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Database Initialization
await initDb();

// REST API Endpoints

// 1. Auth: Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ 
        error: 'Username must be at least 3 characters and password at least 6 characters' 
      });
    }

    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    // Use cute RoboHash kittens as avatars
    const avatarUrl = `https://robohash.org/${encodeURIComponent(username)}?set=set4&size=150x150`;

    const userId = await createUser(username, passwordHash, avatarUrl);
    const user = { id: userId, username, avatar_url: avatarUrl };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// 2. Auth: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const userPayload = { id: user.id, username: user.username, avatar_url: user.avatar_url };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({ user: userPayload, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// 3. Get all users (except current user)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await getAllUsers();
    const filteredUsers = users.filter(u => u.id !== req.user.id);
    res.json(filteredUsers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 4. Get all rooms for user (groups and direct messaging rooms)
app.get('/api/rooms', authenticateToken, async (req, res) => {
  try {
    const rooms = await getRoomsForUser(req.user.id);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// 5. Get direct message room with user (creates if not exists)
app.post('/api/rooms/direct', authenticateToken, async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (!recipientId) return res.status(400).json({ error: 'Recipient ID is required' });

    const roomId = await getOrCreateDirectRoom(req.user.id, parseInt(recipientId));
    
    // Get updated room details to send back
    const rooms = await getRoomsForUser(req.user.id);
    const room = rooms.find(r => r.id === roomId);

    res.json(room);
  } catch (err) {
    console.error('Failed to get or create direct room:', err);
    res.status(500).json({ error: 'Failed to get or create direct room' });
  }
});

// 6. Get messages for a room
app.get('/api/messages/:roomId', authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const messages = await getMessagesForRoom(roomId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Real-Time Communication (Socket.io)

// Map to track online users: userId -> Map of socket.id -> socket
const onlineUsers = new Map();

// Authentication middleware for Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: Token missing'));
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) return next(new Error('Authentication error: Invalid token'));
    socket.user = decodedUser;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  const username = socket.user.username;

  console.log(`User connected: ${username} (ID: ${userId})`);

  // Track socket connections for the user
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Map());
  }
  onlineUsers.get(userId).set(socket.id, socket);

  // Join a room dedicated to this user ID, allowing direct notifications/messages to be routed easily
  socket.join(`user_${userId}`);

  // Broadcast user online status
  io.emit('status_change', { userId, status: 'online' });

  // Handle request for current online users
  socket.on('get_online_users', (callback) => {
    const onlineIds = Array.from(onlineUsers.keys());
    if (typeof callback === 'function') callback(onlineIds);
  });

  // Handle joining a room channel
  socket.on('join_room', (roomId) => {
    socket.join(`room_${roomId}`);
    console.log(`User ${username} joined room_${roomId}`);
  });

  // Handle leaving a room channel
  socket.on('leave_room', (roomId) => {
    socket.leave(`room_${roomId}`);
    console.log(`User ${username} left room_${roomId}`);
  });

  // Handle sending a message
  socket.on('send_message', async (data, callback) => {
    try {
      const { roomId, content } = data;
      if (!roomId || !content) return;

      const messageId = await saveMessage(roomId, userId, content);
      const message = await getMessageById(messageId);

      // Emit message to everyone in the room
      io.to(`room_${roomId}`).emit('receive_message', message);
      
      // Also notify direct message recipient if they are not in the room yet (forces chat list update)
      // We can emit a event to trigger room list updates
      io.emit('new_message_alert', { roomId, senderId: userId });

      if (typeof callback === 'function') callback({ success: true, message });
    } catch (err) {
      console.error('Error saving/sending message:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Typing indicators
  socket.on('typing', (data) => {
    const { roomId } = data;
    socket.to(`room_${roomId}`).emit('user_typing', { roomId, userId, username });
  });

  socket.on('stop_typing', (data) => {
    const { roomId } = data;
    socket.to(`room_${roomId}`).emit('user_stop_typing', { roomId, userId });
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id} (User: ${username})`);
    
    const userSockets = onlineUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      
      // If user has no active sockets left, they are truly offline
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        io.emit('status_change', { userId, status: 'offline' });
        console.log(`User logged off completely: ${username} (ID: ${userId})`);
      }
    }
  });
});

// Start Server
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
