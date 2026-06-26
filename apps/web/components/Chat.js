'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '@/lib/useSocket';
import { useAuth } from '@/lib/AuthContext';

async function loadHistoryWithRetry(emit, channel, maxAttempts = 10, delayMs = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await emit('load_chat_messages', { channel });
    if (res?.ok && Array.isArray(res.messages)) {
      return res.messages;
    }
    if (res?.error !== 'no_room' && res?.error !== 'not_in_room') {
      break;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return [];
}

export default function Chat({ channel, roomCode }) {
  const { emit, on, connected } = useSocket();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  const reloadHistory = useCallback(async () => {
    const list = await loadHistoryWithRetry(emit, channel);
    setMessages(list);
  }, [emit, channel]);

  useEffect(() => {
    if (!connected || !channel) return;
    let cancelled = false;
    (async () => {
      const list = await loadHistoryWithRetry(emit, channel);
      if (!cancelled) setMessages(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, channel, roomCode, emit]);

  useEffect(() => {
    if (!connected) return;
    const off = on('chat_message', (msg) => {
      if (msg.channel !== channel) return;
      setMessages((prev) => {
        if (prev.some((p) => p.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return off;
  }, [on, channel, connected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await emit('chat_message', { channel, body: text.trim() });
    setText('');
    if (!res?.ok) {
      await reloadHistory();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-center text-white/20 text-sm py-4">Brak wiadomości</p>
        )}
        {messages.map((msg) => {
          const isOwn = msg.userId === user?.id;
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
            >
              {!isOwn && (
                <span className="text-[10px] text-white/30 mb-0.5 ml-1">
                  {msg.username}
                </span>
              )}
              <div
                className={`rounded-2xl px-3 py-1.5 max-w-[80%] text-sm break-words
                  ${isOwn ? 'bg-town text-white rounded-br-md' : 'bg-white/10 rounded-bl-md'}
                `}
              >
                {msg.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-white/10 flex gap-2">
        <input
          type="text"
          className="input flex-1 text-sm"
          placeholder="Napisz wiadomość..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn-primary px-4" disabled={!text.trim()}>
          Wyślij
        </button>
      </form>
    </div>
  );
}
