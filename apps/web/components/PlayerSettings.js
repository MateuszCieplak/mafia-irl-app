'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

export default function PlayerSettings({ onSaved }) {
  const { user, pb, refreshUser } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
  const avatarUrl = user?.avatar
    ? `${pbUrl}/api/files/users/${user.id}/${user.avatar}`
    : null;

  async function handleSaveName(e) {
    e.preventDefault();
    if (!username.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      await pb.collection('users').update(user.id, { username: username.trim() });
      await refreshUser();
      setMessage('Nazwa zapisana');
      onSaved?.();
    } catch (err) {
      setMessage(err?.message || 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      await pb.collection('users').update(user.id, formData);
      await refreshUser();
      setMessage('Avatar zaktualizowany');
      onSaved?.();
    } catch (err) {
      setMessage(err?.message || 'Błąd uploadu');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-20 h-20 rounded-full overflow-hidden bg-white/10 ring-2 ring-white/20">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-white/50">
              {(username || user?.email || '?')[0].toUpperCase()}
            </div>
          )}
        </div>
        <label className="btn-secondary text-xs cursor-pointer">
          Zmień zdjęcie
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleAvatarChange}
            disabled={saving}
          />
        </label>
      </div>

      <form onSubmit={handleSaveName} className="space-y-3">
        <label className="block text-xs text-white/50 uppercase tracking-wide">Nazwa gracza</label>
        <input
          type="text"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={32}
          placeholder="Twoja nazwa"
        />
        <button type="submit" className="btn-primary w-full" disabled={saving || !username.trim()}>
          {saving ? 'Zapisuję…' : 'Zapisz nazwę'}
        </button>
      </form>

      {message && <p className="text-center text-sm text-white/60">{message}</p>}
    </div>
  );
}
