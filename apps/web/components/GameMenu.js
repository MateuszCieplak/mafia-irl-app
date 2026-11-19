'use client';

import { useEffect, useState } from 'react';
import RolePlayerList from './RolePlayerList';
import PlayerSettings from './PlayerSettings';
import CardsPanel from './CardsPanel';
import { useAuth } from '@/lib/AuthContext';
import { userAvatarUrl } from '@/lib/avatar';

const TITLES = {
  root: 'Menu',
  profile: 'Mój profil',
  players: 'Gracze',
  cards: 'Karty mocy',
};

export default function GameMenu({
  open,
  onClose,
  players,
  role,
  roomCode,
  isMaster,
  detectiveHistory,
  lastDoctorTarget,
  recentlyEliminatedId,
  onProfileSaved,
  cards = [],
  cardLog = [],
  mafiaCard = null,
  round = 0,
}) {
  const { user } = useAuth();
  const [view, setView] = useState('root');
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setView('root');
      setClosing(false);
      setVisible(true);
    } else if (visible) {
      setClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, 220);
      return () => clearTimeout(t);
    }
  }, [open, visible]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const alive = players.filter((p) => !p.isMaster && !p.eliminated).length;
  const total = players.filter((p) => !p.isMaster).length;
  const avatar = userAvatarUrl(user);
  const displayName = user?.username || user?.email?.split('@')[0] || 'Gracz';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <button
        type="button"
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        aria-label="Zamknij menu"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-label={TITLES[view]}
        className={`relative w-full max-w-lg sm:mx-4 max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#12121a] border border-brass-500/25 shadow-2xl overflow-hidden ${
          closing ? 'animate-popup-out' : 'animate-popup-in'
        }`}
      >
        {/* Nagłówek: wstecz · tytuł · zamknij */}
        <div className="shrink-0 grid grid-cols-[2.5rem_1fr_2.5rem] items-center px-3 py-3 border-b border-white/10">
          {view === 'root' ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => setView('root')}
              aria-label="Wróć do menu"
              className="h-9 w-9 rounded-full text-white/60 hover:bg-white/10 hover:text-white transition"
            >
              ←
            </button>
          )}
          <h2 className="font-display font-bold text-lg text-center">{TITLES[view]}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij menu"
            className="h-9 w-9 rounded-full text-white/60 hover:bg-white/10 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        <div key={view} className="flex-1 min-h-0 overflow-y-auto p-4 animate-fade-in">
          {view === 'root' && (
            <div className="stagger space-y-3">
              <MenuTile
                onClick={() => setView('profile')}
                leading={
                  avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt="" className="w-12 h-12 rounded-full object-cover ring-1 ring-white/20" />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold text-white/60 ring-1 ring-white/10">
                      {displayName[0].toUpperCase()}
                    </span>
                  )
                }
                title="Mój profil"
                subtitle={`${displayName} · zmień nazwę i zdjęcie`}
              />
              <MenuTile
                onClick={() => setView('players')}
                leading={
                  <span className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-xl">
                    👥
                  </span>
                }
                title="Gracze"
                subtitle={`${alive} żywych z ${total} · statusy graczy`}
              />
              {!isMaster && cards.length > 0 && (
                <MenuTile
                  onClick={() => setView('cards')}
                  leading={
                    <span className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-xl">
                      🃏
                    </span>
                  }
                  title="Karty mocy"
                  subtitle={
                    cardLog.length > 0
                      ? `Wynik sprawdzenia i stan kart (${cardLog.length})`
                      : 'Twoje karty i wyniki ich użycia'
                  }
                />
              )}
            </div>
          )}

          {view === 'profile' && <PlayerSettings onSaved={onProfileSaved} />}

          {view === 'players' && (
            <RolePlayerList
              players={players}
              role={isMaster ? null : role}
              showRoles={isMaster}
              detectiveHistory={detectiveHistory}
              lastDoctorTarget={lastDoctorTarget}
              roomCode={roomCode}
              recentlyEliminatedId={recentlyEliminatedId}
              cardLog={cardLog}
            />
          )}

          {view === 'cards' && (
            <CardsPanel
              cards={cards}
              cardLog={cardLog}
              mafiaCard={mafiaCard}
              players={players}
              round={round}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MenuTile({ leading, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 text-left rounded-2xl bg-white/5 border border-white/10 px-4 py-3 hover:bg-white/10 transition active:scale-[0.98]"
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block font-display font-semibold">{title}</span>
        <span className="block text-xs text-white/45 truncate">{subtitle}</span>
      </span>
      <span aria-hidden className="text-white/30">›</span>
    </button>
  );
}
