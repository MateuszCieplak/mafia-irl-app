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

  // Telefon z wygaszonym ekranem zamraża stronę i zrywa websocket. Socket.io
  // zauważa to dopiero po heartbeacie (~20 s), więc po powrocie do aplikacji
  // popychamy połączenie ręcznie — inaczej gracz przez kilkanaście sekund
  // ogląda stan sprzed uśpienia.
  useEffect(() => {
    function wake() {
      if (document.visibilityState !== 'visible') return;
      const s = socketRef.current;
      if (s && !s.connected) s.connect();
    }

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
    };
  }, []);

  const emit = useCallback(async (event, data, opts) => {
    const s = socketRef.current;
    if (!s?.connected) {
      return { ok: false, error: 'not_connected' };
    }
    const payload = data === undefined ? {} : data;
    try {
      const res = await s.timeout(opts?.timeoutMs ?? 15000).emitWithAck(event, payload);
      return res !== undefined && res !== null ? res : { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'timeout' };
    }
  }, []);

  /** Twardy restart połączenia — dla socketów, które „żyją” tylko po stronie klienta. */
  const reconnect = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    s.disconnect();
    s.connect();
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
      reconnect,
    }),
    [connected, emit, on, reconnect]
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
