import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onClose,
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <img src="/amp-logo.svg" alt="Amp" className="brand-logo" />
          <div className="brand-text">
            <div className="brand-name">Amp</div>
            <div className="brand-sub">Doctor Council</div>
          </div>
          {onClose && (
            <button
              type="button"
              className="sidebar-close"
              aria-label="Close sidebar"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">
                {conv.title || 'New Conversation'}
              </div>
              <div className="conversation-meta">
                {conv.message_count} messages
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
