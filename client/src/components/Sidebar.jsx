import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Hash, MessageSquare, Search, Users } from 'lucide-react';

export const Sidebar = ({ activeChat, setActiveChat }) => {
  const { user, token, socket, onlineUsers, logout } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const API_URL = 'http://localhost:5000/api';

  const fetchData = async () => {
    try {
      // Fetch user rooms (groups and direct chats)
      const roomsRes = await fetch(`${API_URL}/rooms`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (roomsRes.ok) {
        const roomsData = await roomsRes.json();
        setRooms(roomsData);
      }

      // Fetch all other users
      const usersRes = await fetch(`${API_URL}/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData);
      }
    } catch (err) {
      console.error('Error fetching sidebar data:', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token]);

  // Subscribe to real-time events for sidebar updates
  useEffect(() => {
    if (!socket) return;

    const handleMessageAlert = () => {
      // Refresh rooms to show the latest messages/order
      fetchData();
    };

    socket.on('new_message_alert', handleMessageAlert);
    
    // Status change listener updates onlineUsers inside AuthContext,
    // which triggers re-render automatically. We can also fetch users just in case.
    socket.on('status_change', () => {
      // Optional: force fetch latest avatar changes etc.
    });

    return () => {
      socket.off('new_message_alert', handleMessageAlert);
    };
  }, [socket]);

  const handleUserClick = async (clickedUser) => {
    try {
      // Find or create direct room with this user
      const response = await fetch(`${API_URL}/rooms/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ recipientId: clickedUser.id })
      });

      if (response.ok) {
        const directRoom = await response.json();
        
        // Add to rooms if not already there
        if (!rooms.some(r => r.id === directRoom.id)) {
          setRooms(prev => [directRoom, ...prev]);
        }

        setActiveChat(directRoom);
      }
    } catch (err) {
      console.error('Error starting direct message:', err);
    }
  };

  // Filters
  const filteredRooms = rooms
    .filter(r => r.type === 'group')
    .filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const filteredDirectChats = rooms
    .filter(r => r.type === 'direct')
    .filter(r => r.recipient_username?.toLowerCase().includes(searchQuery.toLowerCase()));

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !rooms.some(r => r.type === 'direct' && r.recipient_id === u.id)
  );

  return (
    <div className="sidebar glass-panel">
      <div className="sidebar-header">
        <div className="logo-area">
          <MessageSquare size={24} className="logo-icon" />
          <span className="logo-text">VibeTalk</span>
        </div>
        <div className="search-container">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search channels, direct messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-content">
        {/* Group Channels */}
        <div>
          <div className="section-title">Channels</div>
          <div className="room-list">
            {filteredRooms.map((room) => (
              <div
                key={room.id}
                className={`list-item ${activeChat?.id === room.id ? 'active' : ''}`}
                onClick={() => setActiveChat(room)}
              >
                <div className="item-hashtag">#</div>
                <div className="item-details">
                  <div className="item-name">{room.name}</div>
                </div>
              </div>
            ))}
            {filteredRooms.length === 0 && (
              <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No channels found
              </div>
            )}
          </div>
        </div>

        {/* Direct Messages (Existing Chats) */}
        <div>
          <div className="section-title">Direct Messages</div>
          <div className="user-list">
            {filteredDirectChats.map((room) => {
              const isOnline = onlineUsers.includes(room.recipient_id);
              return (
                <div
                  key={room.id}
                  className={`list-item ${activeChat?.id === room.id ? 'active' : ''}`}
                  onClick={() => setActiveChat(room)}
                >
                  <div className="avatar-wrapper">
                    <img 
                      src={room.recipient_avatar} 
                      alt={room.recipient_username} 
                      className="user-avatar"
                    />
                    <div className={`status-badge ${isOnline ? 'online' : 'offline'}`} />
                  </div>
                  <div className="item-details">
                    <div className="item-name">{room.recipient_username}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Start a new conversation (Users without DMs yet) */}
        {filteredUsers.length > 0 && (
          <div>
            <div className="section-title">Start Chat</div>
            <div className="user-list">
              {filteredUsers.map((u) => {
                const isOnline = onlineUsers.includes(u.id);
                return (
                  <div
                    key={u.id}
                    className="list-item"
                    onClick={() => handleUserClick(u)}
                  >
                    <div className="avatar-wrapper">
                      <img src={u.avatar_url} alt={u.username} className="user-avatar" />
                      <div className={`status-badge ${isOnline ? 'online' : 'offline'}`} />
                    </div>
                    <div className="item-details">
                      <div className="item-name">{u.username}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="current-user-info">
          <div className="avatar-wrapper">
            <img src={user?.avatar_url} alt={user?.username} className="user-avatar" />
            <div className="status-badge online" />
          </div>
          <div className="item-details">
            <div className="item-name" style={{ fontWeight: '600' }}>{user?.username}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Online</div>
          </div>
        </div>
        <button className="logout-btn" onClick={logout} title="Sign Out">
          <LogOut size={18} />
        </button>
      </div>
    </div>
  );
};
