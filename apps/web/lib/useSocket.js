'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import { io } from 'socket.io-client';
import pb from './pocketbase';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002';

const SocketContext = createContext(null);

/**
 * Jedno połączenie Socket.io na całą aplikację — inaczej join_room i chat_message
 * szłyby na różnych socketach i czat w pokoju nie działał.
 */
export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket = null;

    function syncSocket() {
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
        socketRef.current = null;
        setConnected(false);
      }

      const token = pb.authStore.token;
      if (!token) return;

      socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
      });
      socketRef.current = socket;
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));
    }

    syncSocket();
    const unsub = pb.authStore.onChange(() => {
      syncSocket();
    });

    return () => {
      unsub();
      if (socket) {
        socket.disconnect();
        socket = null;
        socketRef.current = null;
      }
    };
  }, []);

  const emit = useCallback(async (event, data) => {
    const s = socketRef.current;
    if (!s?.connected) {
      return { ok: false, error: 'not_connected' };
    }
    const payload = data === undefined ? {} : data;
    try {
      const res = await s.timeout(15000).emitWithAck(event, payload);
      return res !== undefined && res !== null ? res : { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'timeout' };
    }
  }, []);

  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  const value = useMemo(
    () => ({
      socket: socketRef.current,
      connected,
      emit,
      on,
    }),
    [connected, emit, on]
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocket musi być użyte wewnątrz SocketProvider');
  }
  return ctx;
}
