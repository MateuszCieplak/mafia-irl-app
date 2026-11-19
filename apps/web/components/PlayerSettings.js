'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { userAvatarUrl } from '@/lib/avatar';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default function PlayerSettings({ onSaved }) {
  const { user, pb, refreshUser } = useAuth();
  const fileRef = useRef(null);
  const [username, setUsername] = useState(user?.username || '');
  const [busy, setBusy] = useState(null); // 'name' | 'avatar' | null
  const [feedback, setFeedback] = useState(null); // { type: 'ok' | 'error', text }
  const [imgBroken, setImgBroken] = useState(false);

  const avatarUrl = imgBroken ? null : userAvatarUrl(user);
  const trimmed = username.trim();
  const nameChanged = trimmed !== (user?.username || '');
  const initial = (trimmed || user?.email || '?')[0].toUpperCase();

  function notify(type, text) {
    setFeedback({ type, text, id: Date.now() });
  }

  async function saveName(e) {
    e.preventDefault();
    if (!trimmed || !nameChanged) return;
    setBusy('name');
    setFeedback(null);
    try {
      await pb.collection('users').update(user.id, { username: trimmed });
      await refreshUser();
      notify('ok', 'Nazwa zapisana');
      onSaved?.();
    } catch (err) {
      const taken = err?.response?.data?.username;
      notify('error', taken ? 'Ta nazwa jest już zajęta' : err?.message || 'Nie udało się zapisać nazwy');
    } finally {
      setBusy(null);
    }
  }

  async function pickAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      notify('error', 'Dozwolone formaty: JPG, PNG, WEBP, GIF');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      notify('error', 'Zdjęcie jest za duże (max 5 MB)');
      return;
    }
    setBusy('avatar');
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      await pb.collection('users').update(user.id, formData);
      await refreshUser();
      setImgBroken(false);
      notify('ok', 'Zdjęcie zaktualizowane');
      onSaved?.();
    } catch (err) {
      notify('error', err?.response?.data?.avatar?.message || err?.message || 'Nie udało się wgrać zdjęcia');
    } finally {
      setBusy(null);
    }
  }

  async function removeAvatar() {
    setBusy('avatar');
    setFeedback(null);
    try {
      await pb.collection('users').update(user.id, { avatar: null });
      await refreshUser();
      setImgBroken(false);
      notify('ok', 'Zdjęcie usunięte');
      onSaved?.();
    } catch (err) {
      notify('error', err?.message || 'Nie udało się usunąć zdjęcia');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Avatar */}
      <section className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy === 'avatar'}
          className="group relative w-28 h-28 rounded-full overflow-hidden bg-white/10 ring-2 ring-brass-500/40 transition active:scale-95 focus:outline-none focus-visible:ring-brass-400"
          aria-label="Zmień zdjęcie profilowe"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-4xl font-bold text-white/50">
              {initial}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-[12px] font-semibold text-white/90 opacity-90 group-hover:opacity-100">
            {busy === 'avatar' ? '…' : '📷 Zmień'}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          className="hidden"
          onChange={pickAvatar}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={busy === 'avatar'}
          >
            {user?.avatar ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
          </button>
          {user?.avatar && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={removeAvatar}
              disabled={busy === 'avatar'}
            >
              Usuń zdjęcie
            </button>
          )}
        </div>
        <p className="text-[12px] text-white/35">JPG, PNG, WEBP lub GIF · do 5 MB</p>
      </section>

      {/* Nazwa */}
      <form onSubmit={saveName} className="space-y-2">
        <label htmlFor="player-name" className="block text-[12px] text-white/50 uppercase tracking-wider">
          Nazwa gracza
        </label>
        <div className="flex gap-2">
          <input
            id="player-name"
            type="text"
            className="input flex-1 min-w-0"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            placeholder="Twoja nazwa"
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn-primary shrink-0"
            disabled={busy === 'name' || !trimmed || !nameChanged}
          >
            {busy === 'name' ? '…' : 'Zapisz'}
          </button>
        </div>
      </form>

      {feedback && (
        <p
          key={feedback.id}
          role="status"
          className={`rounded-lg px-3 py-2 text-center text-sm animate-fade-up ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-blood/20 text-paper-100'
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
