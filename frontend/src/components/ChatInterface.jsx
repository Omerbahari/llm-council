import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import './ChatInterface.css';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result is a data URL: "data:image/png;base64,iVBOR..."
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1] || '';
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data_base64: base64,
        data_url: dataUrl,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastMessageCountRef = useRef(0);

  // Only auto-scroll when (a) a NEW message is added, or (b) the user is
  // already at the bottom. Don't yank the user down while they're reading
  // older content as new stream events arrive.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const messageCount = conversation?.messages?.length || 0;
    const newMessageAppeared = messageCount > lastMessageCountRef.current;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 120;
    if (newMessageAppeared || isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    lastMessageCountRef.current = messageCount;
  }, [conversation]);

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const loaded = await Promise.all(files.map(readFileAsBase64));
      setAttachments((prev) => [...prev, ...loaded]);
    } catch (err) {
      console.error('Failed to read file(s):', err);
    }
    // reset so the same file can be re-picked
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items || [];
    const images = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length > 0) {
      e.preventDefault();
      try {
        const loaded = await Promise.all(images.map(readFileAsBase64));
        setAttachments((prev) => [...prev, ...loaded]);
      } catch (err) {
        console.error('Failed to read pasted image:', err);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const content = input.trim();
    if ((!content && attachments.length === 0) || isLoading) return;
    onSendMessage(content, attachments);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <img src="/amp-logo.svg" alt="Amp" className="welcome-logo" />
          <h2>Welcome to Amp Doctor Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isLoading;

  return (
    <div className="chat-interface">
      <div className="messages-container" ref={messagesContainerRef}>
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <img src="/amp-logo.svg" alt="Amp" className="welcome-logo" />
            <h2>Start a conversation</h2>
            <p>Ask the council anything — paste images or attach files too</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                  {msg.files && msg.files.length > 0 && (
                    <div className="message-attachments">
                      {msg.files.map((f, i) =>
                        f.type?.startsWith('image/') && f.data_url ? (
                          <img
                            key={i}
                            src={f.data_url}
                            alt={f.name}
                            className="attachment-thumb"
                          />
                        ) : (
                          <div key={i} className="attachment-file">
                            {f.name}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {msg.content && (
                    <div className="message-content">
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">Amp Doctor Council</div>

                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses…</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} />}

                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings…</span>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis…</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && conversation.messages.length === 0 && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((f, i) => (
              <div key={i} className="attachment-chip">
                {f.type.startsWith('image/') && f.data_url ? (
                  <img src={f.data_url} alt={f.name} className="chip-thumb" />
                ) : (
                  <span className="chip-icon">📄</span>
                )}
                <span className="chip-name" title={f.name}>{f.name}</span>
                <span className="chip-size">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => removeAttachment(i)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="input-row">
          <button
            type="button"
            className="attach-button"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.log"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <textarea
            className="message-input"
            placeholder="Ask the council… (Shift+Enter for newline, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading}
            rows={2}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!canSend}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
