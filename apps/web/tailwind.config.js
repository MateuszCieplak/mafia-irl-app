/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        night: '#0a0a0f',
        blood: '#b91c1c',
        town: '#1d4ed8',
        safe: '#16a34a',
        role: {
          mafia: '#dc2626',
          detective: '#22c55e',
          doctor: '#3b82f6',
          citizen: '#d97706',
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
      },
      animation: {
        'popup-in': 'popup-in 0.28s ease-out forwards',
        'popup-out': 'popup-out 0.22s ease-in forwards',
        'phase-fade': 'phase-fade 0.45s ease-out forwards',
        'kill-pulse': 'kill-pulse 1.2s ease-in-out 2',
        'reveal-in': 'reveal-in 0.6s ease-out forwards',
        'role-reveal': 'role-reveal 0.8s ease-out forwards',
      },
    },
  },
  plugins: [],
};
