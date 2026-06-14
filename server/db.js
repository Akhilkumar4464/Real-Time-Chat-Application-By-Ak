import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'chat.db');

let db;

export async function initDb() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Create Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Rooms table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL, -- 'group' or 'direct'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Room Members table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id INTEGER,
      user_id INTEGER,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create Messages table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create default rooms if they don't exist
  await seedDefaultRooms();

  console.log('Database initialized successfully.');
  return db;
}

async function seedDefaultRooms() {
  const defaultRooms = [
    { name: 'general', type: 'group' },
    { name: 'random', type: 'group' },
    { name: 'announcements', type: 'group' }
  ];

  for (const room of defaultRooms) {
    try {
      await db.run(
        'INSERT INTO rooms (name, type) VALUES (?, ?)',
        [room.name, room.type]
      );
      console.log(`Created default room: #${room.name}`);
    } catch (err) {
      // Room already exists, ignore
    }
  }
}

// User helper functions
export async function createUser(username, passwordHash, avatarUrl) {
  const result = await db.run(
    'INSERT INTO users (username, password_hash, avatar_url) VALUES (?, ?, ?)',
    [username, passwordHash, avatarUrl]
  );
  return result.lastID;
}

export async function getUserByUsername(username) {
  return await db.get('SELECT * FROM users WHERE username = ?', [username]);
}

export async function getUserById(id) {
  return await db.get('SELECT id, username, avatar_url, created_at FROM users WHERE id = ?', [id]);
}

export async function getAllUsers() {
  return await db.all('SELECT id, username, avatar_url FROM users ORDER BY username ASC');
}

// Room helper functions
export async function createRoom(name, type) {
  const result = await db.run(
    'INSERT INTO rooms (name, type) VALUES (?, ?)',
    [name, type]
  );
  return result.lastID;
}

export async function addRoomMember(roomId, userId) {
  try {
    await db.run(
      'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
      [roomId, userId]
    );
  } catch (err) {
    // Member already added, ignore
  }
}

export async function isRoomMember(roomId, userId) {
  const member = await db.get(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  return !!member;
}

export async function getRoomsForUser(userId) {
  // Get all group rooms, and any direct rooms where the user is a member
  // For group rooms, users don't necessarily have to be registered in room_members to view them, or we can make it so all users are members of group rooms by default, or return all group rooms plus any direct rooms they belong to.
  // Let's return all group rooms, and for direct rooms, return them only if the user is a member.
  const groups = await db.all("SELECT id, name, type FROM rooms WHERE type = 'group' ORDER BY name ASC");
  
  const directRooms = await db.all(`
    SELECT r.id, r.name, r.type, u.username as recipient_username, u.id as recipient_id, u.avatar_url as recipient_avatar
    FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id != ?
    JOIN users u ON rm2.user_id = u.id
    WHERE r.type = 'direct'
  `, [userId, userId]);

  return [...groups, ...directRooms];
}

export async function getOrCreateDirectRoom(user1Id, user2Id) {
  // Check if a direct room already exists between these two users
  const existingRoom = await db.get(`
    SELECT r.id, r.name, r.type
    FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id
    JOIN room_members rm2 ON r.id = rm2.room_id
    WHERE r.type = 'direct'
      AND rm1.user_id = ?
      AND rm2.user_id = ?
  `, [user1Id, user2Id]);

  if (existingRoom) {
    return existingRoom.id;
  }

  // Create a new direct room
  // Use a unique name like direct_user1_user2
  const roomName = `direct_${Math.min(user1Id, user2Id)}_${Math.max(user1Id, user2Id)}`;
  const roomId = await createRoom(roomName, 'direct');
  
  // Add both members
  await addRoomMember(roomId, user1Id);
  await addRoomMember(roomId, user2Id);

  return roomId;
}

// Message helper functions
export async function saveMessage(roomId, senderId, content) {
  const result = await db.run(
    'INSERT INTO messages (room_id, sender_id, content) VALUES (?, ?, ?)',
    [roomId, senderId, content]
  );
  return result.lastID;
}

export async function getMessagesForRoom(roomId, limit = 100) {
  return await db.all(`
    SELECT m.id, m.room_id, m.sender_id, m.content, m.created_at, u.username as sender_username, u.avatar_url as sender_avatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `, [roomId, limit]);
}

export async function getMessageById(messageId) {
  return await db.get(`
    SELECT m.id, m.room_id, m.sender_id, m.content, m.created_at, u.username as sender_username, u.avatar_url as sender_avatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `, [messageId]);
}
