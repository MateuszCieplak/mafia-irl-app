'use client';

import { useState, useEffect, useRef } from 'react';

export default function Notepad({ roomCode }) {
  const key = `mafia_notes_${roomCode}`;
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);

  // Panel wjeżdża i wyjeżdża (odroczony unmount po animacji wyjścia).
  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setVisible(true);
      setClosing(false);
    } else {
      setClosing(true);
      timer.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, 200);
    }
    return () => clearTimeout(timer.current);
  }, [open]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNotes(localStorage.getItem(key) || '');
    }
  }, [key]);

  function handleChange(e) {
    setNotes(e.target.value);
    localStorage.setItem(key, e.target.value);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn-secondary text-xs"
      >
        Notatki
      </button>

      {visible && (
        <div
          className={`absolute bottom-full right-0 mb-2 w-72 card shadow-2xl z-50 origin-bottom-right ${
            closing ? 'animate-popup-out' : 'animate-popup-in'
          }`}
        >
          <textarea
            className="w-full h-40 bg-transparent text-sm text-white resize-none outline-none placeholder:text-white/30"
            placeholder="Twoje prywatne notatki..."
            value={notes}
            onChange={handleChange}
          />
        </div>
      )}
    </div>
  );
}
