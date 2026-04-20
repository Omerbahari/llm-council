import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 768 : true
  );

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleSendMessage = async (content, attachments = []) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI (with any attachments)
      const userMessage = {
        role: 'user',
        content,
        files: attachments.map((a) => ({
          name: a.name,
          type: a.type,
          size: a.size,
          data_url: a.data_url,
        })),
      };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      const updateLastAssistant = (patch) => {
        setCurrentConversation((prev) => {
          if (!prev || !prev.messages || prev.messages.length === 0) return prev;
          const messages = prev.messages.slice();
          const idx = messages.length - 1;
          const last = messages[idx];
          if (!last || last.role !== 'assistant') return prev;
          messages[idx] = {
            ...last,
            ...patch,
            loading: { ...last.loading, ...(patch.loading || {}) },
          };
          return { ...prev, messages };
        });
      };

      // Send message with streaming
      const filesPayload = attachments.map((a) => ({
        name: a.name,
        type: a.type,
        data_base64: a.data_base64,
      }));
      await api.sendMessageStream(currentConversationId, content, filesPayload, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            updateLastAssistant({ loading: { stage1: true } });
            break;

          case 'stage1_complete':
            updateLastAssistant({ stage1: event.data, loading: { stage1: false } });
            break;

          case 'stage2_start':
            updateLastAssistant({ loading: { stage2: true } });
            break;

          case 'stage2_complete':
            updateLastAssistant({
              stage2: event.data,
              metadata: event.metadata,
              loading: { stage2: false },
            });
            break;

          case 'stage3_start':
            updateLastAssistant({ loading: { stage3: true } });
            break;

          case 'stage3_complete':
            updateLastAssistant({ stage3: event.data, loading: { stage3: false } });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  };

  const handleSelectConversationMobile = (id) => {
    handleSelectConversation(id);
    closeSidebarOnMobile();
  };

  const handleNewConversationMobile = async () => {
    await handleNewConversation();
    closeSidebarOnMobile();
  };

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversationMobile}
        onNewConversation={handleNewConversationMobile}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="main-column">
        <header className="mobile-header">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="mobile-title">
            <img src="/amp-logo.svg" alt="Amp" />
            <span>Amp Doctor Council</span>
          </div>
        </header>
        <ChatInterface
          conversation={currentConversation}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

export default App;
