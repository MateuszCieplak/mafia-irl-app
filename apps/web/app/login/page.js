'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/lobby');
    } catch (err) {
      setError('Nieprawidłowy email lub hasło');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="relative mb-8 w-28">
        <img
          src="/logo.png"
          alt="Sieje Hot Crew"
          className="w-full h-auto select-none"
          draggable={false}
        />
        <h1 className="pointer-events-none absolute bottom-0 right-0 translate-x-1/2 font-display text-4xl font-bold tracking-tight whitespace-nowrap text-blood">
          MAFIA
        </h1>
      </div>
      <p className="text-white/50 mb-8">Zaloguj się, żeby grać</p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <input
          type="email"
          placeholder="Email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <input
          type="password"
          placeholder="Hasło"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {error && <p className="text-blood text-sm text-center">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Logowanie...' : 'Zaloguj'}
        </button>
      </form>

      <p className="mt-6 text-white/40 text-sm">
        Nie masz konta?{' '}
        <Link href="/register" className="text-white underline">
          Zarejestruj się
        </Link>
      </p>
    </div>
  );
}
