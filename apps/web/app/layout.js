import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import { SocketProvider } from '@/lib/useSocket';
import RoomInviteListener from '@/components/RoomInviteListener';

const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata = {
  title: 'Mafia IRL',
  description: 'Party game for your next gathering',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
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
