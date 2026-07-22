'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email, password, username);
      router.push('/lobby');
    } catch (err) {
      setError(err?.response?.message || 'Błąd rejestracji');
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
        <h1 className="pointer-events-none absolute bottom-0 right-0 translate-x-1/2 font-display text-4xl font-bold tracking-tight whitespace-nowrap">
          MAFIA
        </h1>
      </div>
      <p className="text-white/50 mb-8">Utwórz konto</p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <input
          type="text"
          placeholder="Nazwa gracza"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          minLength={3}
        />
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
          placeholder="Hasło (min. 8 znaków)"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
        />
        {error && <p className="text-blood text-sm text-center">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Rejestracja...' : 'Zarejestruj'}
        </button>
      </form>

      <p className="mt-6 text-white/40 text-sm">
        Masz już konto?{' '}
        <Link href="/login" className="text-white underline">
          Zaloguj się
        </Link>
      </p>
    </div>
  );
}
