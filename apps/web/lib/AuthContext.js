'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import pb from './pocketbase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setUser(pb.authStore.record);
    setLoading(false);

    const unsub = pb.authStore.onChange((_token, record) => {
      setUser(record);
    });
    return unsub;
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await pb.collection('users').authWithPassword(email, password);
    setUser(result.record);
    return result;
  }, []);

  const register = useCallback(async (email, password, username) => {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password,
      username,
    });
    return login(email, password);
  }, [login]);

  const logout = useCallback(() => {
    pb.authStore.clear();
    setUser(null);
    router.push('/login');
  }, [router]);

  const refreshUser = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    try {
      const result = await pb.collection('users').authRefresh();
      setUser(result.record);
    } catch {
      /* ignore */
    }
  }, [pb]);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, pb, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
