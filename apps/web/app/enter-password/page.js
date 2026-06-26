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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight">Mafia IRL</h1>
          <p className="text-gray-500 text-sm mt-1">Wpisz hasło dostępu, aby kontynuować</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Hasło"
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              autoFocus
              autoComplete="current-password"
            />
            {error && (
              <p className="text-red-400 text-sm mt-2">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            {loading ? 'Sprawdzam…' : 'Wejdź'}
          </button>
        </form>
      </div>
    </div>
  );
}
