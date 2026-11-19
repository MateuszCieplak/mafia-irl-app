/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        night: '#0b0908',
        ink: { 900: '#0e0b09', 800: '#15110e', 700: '#1d1814', 600: '#2a231c' },
        paper: { 100: '#f1e6cc', 200: '#e4d3ae', 300: '#cdb88a' },
        brass: { 400: '#c9a24d', 500: '#a8832f' },
        blood: '#c0392b',
        town: '#6b4f1d',
        safe: '#5fae7a',
        flame: {
          400: '#b3342b',
          500: '#8f1d1d',
          600: '#741515',
        },
        gold: {
          400: '#d4af5a',
          500: '#c9a24d',
        },
        role: {
          mafia: '#d9453a',
          detective: '#6fbf8a',
          doctor: '#7aa5d8',
          citizen: '#d4af5a',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      keyframes: {
        'popup-in': {
          '0%': { opacity: '0', transform: 'scale(0.92) translateY(8px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'popup-out': {
          '0%': { opacity: '1', transform: 'scale(1) translateY(0)' },
          '100%': { opacity: '0', transform: 'scale(0.92) translateY(8px)' },
        },
        'phase-fade': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'kill-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35', transform: 'scale(0.97)' },
        },
        'reveal-in': {
          '0%': { opacity: '0', transform: 'scale(0.85)' },
          '60%': { opacity: '1', transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'role-reveal': {
          '0%': { opacity: '0', letterSpacing: '0.3em', transform: 'scale(0.9)' },
          '100%': { opacity: '1', letterSpacing: '0.05em', transform: 'scale(1)' },
        },
        // ---- Zestaw animacji UI (stary papier / mafia): tylko opacity + transform ----
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-out': { '0%': { opacity: '1' }, '100%': { opacity: '0' } },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'page-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-bottom': {
          '0%': { opacity: '0', transform: 'translateY(28px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        // baner z góry z lekkim „odbiciem"
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-110%)' },
          '55%': { opacity: '1', transform: 'translateY(6px)' },
          '80%': { transform: 'translateY(-2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // baner z dołu z lekkim „odbiciem" (zaproszenie)
        'slide-up-bounce': {
          '0%': { opacity: '0', transform: 'translateY(110%)' },
          '55%': { opacity: '1', transform: 'translateY(-6px)' },
          '80%': { transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-out-bottom': {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(40px)' },
        },
        'slide-out-up': {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-40px)' },
        },
        'slide-out-right': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(28px)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'scale-out': {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.94)' },
        },
        // krótki „stempel" przy zmianie wartości (np. faza)
        'badge-pop': {
          '0%': { opacity: '0', transform: 'scale(0.85)' },
          '60%': { opacity: '1', transform: 'scale(1.05)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-5px)' },
          '40%': { transform: 'translateX(4px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(2px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'popup-in': 'popup-in 0.28s ease-out forwards',
        'popup-out': 'popup-out 0.22s ease-in forwards',
        'phase-fade': 'phase-fade 0.45s ease-out forwards',
        'kill-pulse': 'kill-pulse 1.2s ease-in-out 2',
        'reveal-in': 'reveal-in 0.6s ease-out forwards',
        'role-reveal': 'role-reveal 0.8s ease-out forwards',
        // Wejścia używają `backwards` (nie `forwards`), żeby po animacji nie zostawał
        // transform (tworzyłby containing block dla position: fixed).
        'fade-in': 'fade-in 0.3s ease-out backwards',
        'fade-out': 'fade-out 0.22s ease-in forwards',
        'fade-up': 'fade-up 0.4s ease-out backwards',
        'page-in': 'page-in 0.35s ease-out backwards',
        'slide-in-bottom': 'slide-in-bottom 0.4s ease-out backwards',
        'slide-in-right': 'slide-in-right 0.35s ease-out backwards',
        'slide-in-left': 'slide-in-left 0.35s ease-out backwards',
        'slide-down': 'slide-down 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'slide-up-bounce': 'slide-up-bounce 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'slide-out-bottom': 'slide-out-bottom 0.25s ease-in forwards',
        'slide-out-up': 'slide-out-up 0.25s ease-in forwards',
        'slide-out-right': 'slide-out-right 0.25s ease-in forwards',
        'scale-in': 'scale-in 0.28s ease-out backwards',
        'scale-out': 'scale-out 0.2s ease-in forwards',
        'badge-pop': 'badge-pop 0.35s ease-out backwards',
        'shake': 'shake 0.4s ease-in-out',
        'shimmer': 'shimmer 2.2s linear infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
