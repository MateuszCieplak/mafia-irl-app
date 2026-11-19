'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import BrandHeader from '@/components/BrandHeader';

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
      <BrandHeader subtitle="Zaloguj się, żeby grać" />

      <form onSubmit={handleSubmit} className="auth-card stagger space-y-4 animate-scale-in [animation-delay:120ms]">
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
        {error && (
          <p key={error} style={{ '--i': 0 }} className="text-blood text-sm text-center animate-shake">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Logowanie...' : 'Zaloguj'}
        </button>
      </form>

      <p className="mt-6 text-paper-200/40 text-sm animate-fade-in [animation-delay:450ms]">
        Nie masz konta?{' '}
        <Link href="/register" className="text-brass-400 underline underline-offset-4 hover:text-paper-100">
          Zarejestruj się
        </Link>
      </p>
    </div>
  );
}
