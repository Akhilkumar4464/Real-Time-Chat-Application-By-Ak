import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Send, Smile, User, MessageSquare } from 'lucide-react';

export const ChatArea = ({ activeChat }) => {
  const { user, token, socket, onlineUsers } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const API_URL = 'http://localhost:5000/api';

  // Scroll to bottom helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch messages when activeChat changes
  useEffect(() => {
    if (!activeChat || !token) return;

    const fetchMessages = async () => {
      try {
        const response = await fetch(`${API_URL}/messages/${activeChat.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (err) {
        console.error('Error fetching messages:', err);
      }
    };

    fetchMessages();
    setTypingUsers([]); // Reset typing state for new room
  }, [activeChat, token]);

  // Join/Leave Socket.io room & Setup Event Listeners
  useEffect(() => {
    if (!socket || !activeChat) return;

    const roomId = activeChat.id;

    // Join room in Socket server
    socket.emit('join_room', roomId);

    // Setup event listeners
    const handleReceiveMessage = (message) => {
      if (message.room_id === roomId) {
        setMessages((prev) => [...prev, message]);
      }
    };

    const handleUserTyping = (data) => {
      if (data.roomId === roomId && data.userId !== user.id) {
        setTypingUsers((prev) => {
          if (!prev.some(u => u.id === data.userId)) {
            return [...prev, { id: data.userId, username: data.username }];
          }
          return prev;
        });
      }
    };

    const handleUserStopTyping = (data) => {
      if (data.roomId === roomId) {
        setTypingUsers((prev) => prev.filter((u) => u.id !== data.userId));
      }
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('user_typing', handleUserTyping);
    socket.on('user_stop_typing', handleUserStopTyping);

    // Clean up
    return () => {
      socket.emit('leave_room', roomId);
      socket.off('receive_message', handleReceiveMessage);
      socket.off('user_typing', handleUserTyping);
      socket.off('user_stop_typing', handleUserStopTyping);
    };
  }, [socket, activeChat, user.id]);

  // Scroll to bottom on messages list change
  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  // Handle typing state emit
  const handleInputChange = (e) => {
    setNewMessage(e.target.value);

    if (!socket || !activeChat) return;

    // Emit typing event
    socket.emit('typing', { roomId: activeChat.id });

    // Debounce stop_typing event
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { roomId: activeChat.id });
    }, 2000);
  };

  // Submit message
  const handleSend = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket || !activeChat) return;

    // Emit message to Socket server
    socket.emit('send_message', {
      roomId: activeChat.id,
      content: newMessage.trim()
    }, (response) => {
      if (response && response.success) {
        // Stop typing immediately
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        socket.emit('stop_typing', { roomId: activeChat.id });
        setNewMessage('');
      } else {
        console.error('Failed to send message:', response?.error);
      }
    });
  };

  // Helper formatting for timestamps
  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!activeChat) {
    return (
      <div className="chat-area chat-empty-state">
        <MessageSquare size={64} className="chat-empty-icon" />
        <h2>Welcome to VibeTalk</h2>
        <p style={{ maxWidth: '400px' }}>
          Select a channel or message a user from the sidebar list to start exchanging real-time messages!
        </p>
      </div>
    );
  }

  const isDirect = activeChat.type === 'direct';
  const chatTitle = isDirect ? activeChat.recipient_username : `#${activeChat.name}`;
  const isOnline = isDirect && onlineUsers.includes(activeChat.recipient_id);

  return (
    <div className="chat-area">
      {/* Header */}
      <div className="chat-header glass-panel" style={{ borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        <div className="chat-header-info">
          {isDirect ? (
            <div className="avatar-wrapper" style={{ width: '44px', height: '44px' }}>
              <img src={activeChat.recipient_avatar} alt={chatTitle} className="user-avatar" />
              <div className={`status-badge ${isOnline ? 'online' : 'offline'}`} />
            </div>
          ) : (
            <div className="item-hashtag" style={{ width: '44px', height: '44px', fontSize: '1.2rem' }}>#</div>
          )}
          <div>
            <div className="chat-title">{chatTitle}</div>
            <div className="chat-subtitle">
              {isDirect 
                ? (isOnline ? 'Active now' : 'Offline') 
                : 'Group Channel'}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-list">
        {messages.map((msg) => {
          const isSentByMe = msg.sender_id === user.id;
          return (
            <div key={msg.id} className={`message-row ${isSentByMe ? 'sent' : 'received'}`}>
              {!isSentByMe && (
                <img 
                  src={msg.sender_avatar} 
                  alt={msg.sender_username} 
                  className="user-avatar" 
                  style={{ width: '32px', height: '32px', alignSelf: 'flex-end', marginBottom: '4px' }}
                />
              )}
              <div className="message-meta">
                {!isSentByMe && <span className="message-username">{msg.sender_username}</span>}
                <div className="message-bubble">
                  <div className="message-text">{msg.content}</div>
                </div>
                <span className="message-time">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicators */}
      {typingUsers.length > 0 && (
        <div className="typing-container">
          <div className="typing-dots">
            <span className="typing-dot"></span>
            <span className="typing-dot"></span>
            <span className="typing-dot"></span>
          </div>
          <span>
            {typingUsers.map((u) => u.username).join(', ')}
            {typingUsers.length === 1 ? ' is typing...' : ' are typing...'}
          </span>
        </div>
      )}

      {/* Input Form */}
      <div className="chat-input-area">
        <form onSubmit={handleSend} className="chat-input-form">
          <input
            type="text"
            className="chat-input"
            placeholder={isDirect ? `Message ${chatTitle}...` : `Message #${activeChat.name}...`}
            value={newMessage}
            onChange={handleInputChange}
          />
          <button type="submit" className="send-btn" disabled={!newMessage.trim()}>
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};
