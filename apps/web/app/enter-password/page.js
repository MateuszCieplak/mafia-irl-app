'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EnterPasswordPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Nieprawidłowe hasło');
        setLoading(false);
      }
    } catch {
      setError('Błąd połączenia. Spróbuj ponownie.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="auth-card !p-8 animate-scale-in">
        <div className="mb-6 animate-fade-up [animation-delay:120ms]">
          <h1 className="font-display text-2xl font-bold tracking-[0.3em] text-paper-100">MAFIA IRL</h1>
          <p className="text-paper-200/50 text-sm mt-2">Wpisz hasło dostępu, aby kontynuować</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-up [animation-delay:220ms]">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Hasło"
              className="input"
              autoFocus
              autoComplete="current-password"
            />
            {error && (
              <p key={error} className="text-blood text-sm mt-2 animate-shake">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="btn-primary w-full"
          >
            {loading ? 'Sprawdzam…' : 'Wejdź'}
          </button>
        </form>
      </div>
    </div>
  );
}
