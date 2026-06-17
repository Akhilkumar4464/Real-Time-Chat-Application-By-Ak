import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Auth } from './components/Auth';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';

function AppContent() {
  const { user } = useAuth();
  const [activeChat, setActiveChat] = useState(null);

  if (!user) {
    return <Auth />;
  }

  return (
    <div className="app-container">
      <div className="chat-dashboard">
        <Sidebar activeChat={activeChat} setActiveChat={setActiveChat} />
        <ChatArea activeChat={activeChat} />
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
