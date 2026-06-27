'use client';

/**
 * Kanciasta ikona „M" w stylu sycylijskiej mafii — wyostrzony kapelusz + litera M.
 */
export default function MafiaLogo({ className = 'w-12 h-12', onClick, asButton = true }) {
  const svg = (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={asButton ? undefined : true}
    >
      {/* Brim — sharp angular fedora */}
      <path
        d="M4 28 L32 18 L60 28 L58 32 L32 24 L6 32 Z"
        fill="#1a1a1a"
        stroke="#c9a227"
        strokeWidth="1.2"
      />
      {/* Crown */}
      <path
        d="M18 28 L22 12 L32 8 L42 12 L46 28 Z"
        fill="#141414"
        stroke="#c9a227"
        strokeWidth="1"
      />
      {/* Band */}
      <rect x="18" y="26" width="28" height="3" fill="#8b0000" />
      {/* Letter M — sharp serifs */}
      <path
        d="M16 58 L16 38 L24 48 L32 36 L40 48 L48 38 L48 58"
        stroke="#e8dcc8"
        strokeWidth="3.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
      />
      {/* Corner accents */}
      <path d="M8 32 L4 36 L8 40" stroke="#c9a227" strokeWidth="1" fill="none" />
      <path d="M56 32 L60 36 L56 40" stroke="#c9a227" strokeWidth="1" fill="none" />
    </svg>
  );

  if (asButton && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group relative p-2 rounded-xl transition-transform active:scale-95 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        aria-label="Menu gry"
      >
        <div className="absolute inset-0 rounded-xl bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        {svg}
      </button>
    );
  }

  return svg;
}
