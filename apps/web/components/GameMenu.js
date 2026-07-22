'use client';

import { useEffect, useState } from 'react';
import RolePlayerList from './RolePlayerList';
import PlayerSettings from './PlayerSettings';

const VIEWS = {
  root: { label: 'Menu', breadcrumb: ['Menu'] },
  players: { label: 'Lista graczy', breadcrumb: ['Menu', 'Lista graczy'] },
  settings: { label: 'Ustawienia', breadcrumb: ['Menu', 'Ustawienia'] },
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
}) {
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

  if (!visible) return null;

  const crumbs = VIEWS[view]?.breadcrumb || ['Menu'];

  function handleClose() {
    onClose();
  }

  function goBack() {
    if (view === 'root') handleClose();
    else setView('root');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Zamknij menu"
        onClick={handleClose}
      />

      <div
        className={`relative w-full max-w-lg mx-4 mb-4 sm:mb-0 max-h-[85dvh] flex flex-col rounded-2xl bg-[#12121a] border border-white/10 shadow-2xl overflow-hidden ${
          closing ? 'animate-popup-out' : 'animate-popup-in'
        }`}
      >
        {/* Header + breadcrumbs */}
        <div className="shrink-0 px-4 pt-4 pb-2 border-b border-white/10">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button type="button" onClick={goBack} className="text-white/50 text-sm hover:text-white">
              {view === 'root' ? '✕' : '←'}
            </button>
            <h2 className="font-display font-bold text-lg">{VIEWS[view]?.label}</h2>
            <div className="w-6" />
          </div>
          <nav className="flex items-center gap-1 text-[12px] text-white/40 uppercase tracking-wider">
            {crumbs.map((c, i) => (
              <span key={c} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <span className={i === crumbs.length - 1 ? 'text-white/70' : ''}>{c}</span>
              </span>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {view === 'root' && (
            <div className="space-y-2">
              <MenuButton onClick={() => setView('players')}>Lista graczy</MenuButton>
              <MenuButton onClick={() => setView('settings')}>Ustawienia gracza</MenuButton>
            </div>
          )}

          {view === 'players' && (
            <RolePlayerList
              players={players}
              role={isMaster ? null : role}
              showRoles={isMaster}
              detectiveHistory={detectiveHistory}
              lastDoctorTarget={lastDoctorTarget}
              roomCode={roomCode}
              recentlyEliminatedId={recentlyEliminatedId}
            />
          )}

          {view === 'settings' && <PlayerSettings />}
        </div>
      </div>
    </div>
  );
}

function MenuButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl bg-white/5 border border-white/10 px-4 py-4 font-display font-semibold hover:bg-white/10 transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}
