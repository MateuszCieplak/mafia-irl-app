import { Cinzel, Oswald } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import { SocketProvider } from '@/lib/useSocket';
import RoomInviteListener from '@/components/RoomInviteListener';

const oswald = Oswald({ subsets: ['latin'], variable: '--font-body' });
const cinzel = Cinzel({ subsets: ['latin'], variable: '--font-display' });

export const metadata = {
  title: 'Mafia IRL',
  description: 'Party game for your next gathering',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl" className={`${oswald.variable} ${cinzel.variable}`}>
      <body className="font-body min-h-dvh flex flex-col">
        <AuthProvider>
          <SocketProvider>
            {children}
            <RoomInviteListener />
          </SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
