'use client';

import { useEffect, useState } from 'react';
import Chat from '@/components/Chat';
import { labelForPlayer } from '@/components/RolePlayerList';
import { useSocket } from '@/lib/useSocket';
import { useAuth } from '@/lib/AuthContext';

const ICONS = {
  detective: { icon: '📓', label: 'Notes detektywa', title: 'Notes detektywa' },
  doctor: { icon: '📄', label: 'Karta lekarza', title: 'Karta lekarza' },
  mafia: { icon: '💬', label: 'Dziupla Mafii', title: 'Dziupla Mafii' },
};

function Row({ player, dim, children }) {
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm ${
        player.eliminated ? 'opacity-40' : ''
      }`}
    >
      <span className={`truncate ${player.eliminated ? 'line-through' : ''} ${dim ? 'text-white/50' : ''}`}>
        {labelForPlayer(player)}
      </span>
      <span className="shrink-0 flex flex-wrap justify-end gap-1">{children}</span>
    </li>
  );
}

function Pill({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-white/10 text-white/50',
    mafia: 'bg-red-500/20 text-role-mafia',
    safe: 'bg-emerald-500/20 text-role-detective',
    doctor: 'bg-sky-500/20 text-role-doctor',
    warn: 'bg-amber-500/20 text-amber-300',
  };
  return (
    <span className={`text-[12px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${tones[tone]}`}>
      {children}
    </span>
  );
}

function DetectiveNotebook({ players, detectiveHistory }) {
  const checked = new Map(detectiveHistory.map((h) => [h.targetId, h.result?.is_mafia]));
  return (
    <>
      <p className="text-[12px] text-white/40 uppercase tracking-wider mb-2">
        Sprawdzeni: {checked.size}
      </p>
      <ul className="space-y-1.5">
        {players.map((p) => (
          <Row key={p.id} player={p} dim={!checked.has(p.id)}>
            {checked.has(p.id) ? (
              checked.get(p.id) ? (
                <Pill tone="mafia">Mafia</Pill>
              ) : (
                <Pill tone="safe">Nie mafia</Pill>
              )
            ) : (
              <Pill>Niesprawdzony</Pill>
            )}
          </Row>
        ))}
      </ul>
    </>
  );
}

function DoctorSheet({ players, doctorHistory, lastDoctorTarget, repeatBlocked, selfProtectAllowed, meId }) {
  const counts = new Map();
  for (const h of doctorHistory) counts.set(h.targetId, (counts.get(h.targetId) || 0) + 1);
  const last = players.find((p) => p.id === lastDoctorTarget);

  return (
    <>
      <p className="text-[12px] text-white/40 mb-2">
        Ostatnio leczony(a):{' '}
        <span className="text-white/80 font-semibold">{last ? labelForPlayer(last) : '— nikt —'}</span>
      </p>
      <ul className="space-y-1.5">
        {players.map((p) => {
          const n = counts.get(p.id) || 0;
          const isLast = p.id === lastDoctorTarget;
          const blocked = repeatBlocked && isLast;
          const selfBlocked = p.id === meId && !selfProtectAllowed;
          return (
            <Row key={p.id} player={p} dim={n === 0 && !isLast}>
              {isLast && <Pill tone="doctor">Ostatnia runda</Pill>}
              {blocked && <Pill tone="warn">Nie możesz teraz</Pill>}
              {selfBlocked && <Pill tone="warn">Nie możesz siebie</Pill>}
              {n > 0 && <Pill>Leczony {n}×</Pill>}
              {n === 0 && !isLast && !selfBlocked && <Pill>Nie leczony</Pill>}
            </Row>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Ikona w prawym dolnym rogu ekranu gracza — zależnie od roli:
 *  - detektyw: notes ze sprawdzonymi graczami,
 *  - lekarz: karta z historią leczenia (kogo ostatnio, kogo nie wolno teraz),
 *  - mafia: czat mafii (z licznikiem nieprzeczytanych).
 * Po kliknięciu nad ikoną rozwija się dropdown.
 */
export default function RoleCornerMenu({
  role,
  players,
  meId,
  detectiveHistory = [],
  doctorHistory = [],
  lastDoctorTarget = null,
  roomSettings = null,
  chatChannel = null,
  roomCode,
}) {
  const { on, connected } = useSocket();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const cfg = ICONS[role];
  const isChat = role === 'mafia';

  useEffect(() => {
    if (!isChat || !connected || !chatChannel) return;
    const off = on('chat_message', (msg) => {
      if (msg.channel !== chatChannel || msg.userId === meId) return;
      setUnread((n) => (open ? 0 : n + 1));
    });
    return off;
  }, [isChat, on, connected, chatChannel, meId, open]);

  if (!cfg || (isChat && !chatChannel)) return null;

  const selfProtectAllowed = roomSettings?.doctor_can_self_protect !== false;
  const repeatBlocked = roomSettings?.doctor_repeat_protect === false;
  // Detektyw sprawdza innych; lekarz — siebie tylko gdy ustawienie na to pozwala.
  const others = players.filter((p) => !p.isMaster && (role === 'doctor' || p.id !== meId));
  const doctorList = others.filter((p) => p.id !== meId || selfProtectAllowed);

  function toggle() {
    setOpen((o) => !o);
    setUnread(0);
  }

  return (
    <div className="absolute right-3 bottom-full mb-3 z-50 flex flex-col items-end gap-2">
      {open && (
        <div
          className={`flex flex-col overflow-hidden rounded-xl border border-brass-500/30 bg-ink-900/95 backdrop-blur shadow-[0_-10px_30px_rgba(0,0,0,0.5)] animate-slide-in-bottom w-[min(22rem,calc(100vw-1.5rem))] ${
            isChat ? 'h-[50dvh] max-h-[26rem]' : 'max-h-[50dvh]'
          }`}
        >
          <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
            <h3 className="font-display font-bold text-sm">{cfg.title}</h3>
            <button
              type="button"
              onClick={toggle}
              aria-label="Zamknij"
              className="text-white/40 hover:text-white text-sm px-1"
            >
              ✕
            </button>
          </div>
          {isChat ? (
            <div className="flex-1 min-h-0">
              <Chat channel={chatChannel} roomCode={roomCode} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {role === 'detective' && (
                <DetectiveNotebook players={others} detectiveHistory={detectiveHistory} />
              )}
              {role === 'doctor' && (
                <DoctorSheet
                  players={doctorList}
                  doctorHistory={doctorHistory}
                  lastDoctorTarget={lastDoctorTarget}
                  repeatBlocked={repeatBlocked}
                  selfProtectAllowed={selfProtectAllowed}
                  meId={meId}
                />
              )}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={cfg.label}
        className="relative w-12 h-12 rounded-full border border-brass-500/40 bg-ink-800/95 text-2xl shadow-lg flex items-center justify-center transition active:scale-95 hover:border-brass-400/70"
      >
        <span aria-hidden>{cfg.icon}</span>
        {isChat && !open && unread > 0 && (
          <span
            key={unread}
            className="animate-badge-pop absolute -top-1 -right-1 min-w-[1.25rem] rounded-full bg-blood px-1 text-center text-[12px] font-bold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
