'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import BrandHeader from '@/components/BrandHeader';

function getRegisterErrorMessage(err) {
  const fields = err?.response?.data || {};
  if (fields.email) return 'Ten adres e-mail jest już zajęty.';
  if (fields.username) return 'Ta nazwa gracza jest już zajęta.';
  if (fields.password) return 'Hasło jest nieprawidłowe (min. 8 znaków).';
  return err?.response?.message ? 'Błąd rejestracji. Spróbuj ponownie.' : 'Błąd rejestracji.';
}

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
      setError(getRegisterErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <BrandHeader subtitle="Utwórz konto" />

      <form onSubmit={handleSubmit} className="auth-card stagger space-y-4 animate-scale-in [animation-delay:120ms]">
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
        {error && (
          <p key={error} style={{ '--i': 0 }} className="text-blood text-sm text-center animate-shake">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Rejestracja...' : 'Zarejestruj'}
        </button>
      </form>

      <p className="mt-6 text-paper-200/40 text-sm animate-fade-in [animation-delay:450ms]">
        Masz już konto?{' '}
        <Link href="/login" className="text-brass-400 underline underline-offset-4 hover:text-paper-100">
          Zaloguj się
        </Link>
      </p>
    </div>
  );
}
