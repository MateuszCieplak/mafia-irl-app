'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/lobby' : '/login');
    }
  }, [user, loading, router]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <div className="relative w-24 animate-pulse opacity-80">
        <img
          src="/logo.png"
          alt="Sieje Hot Crew"
          className="w-full h-auto select-none"
          draggable={false}
        />
        <div className="pointer-events-none absolute bottom-0 right-0 translate-x-1/2 font-display text-2xl text-white/40 whitespace-nowrap">
          MAFIA
        </div>
      </div>
    </div>
  );
}
