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
    <div className="flex-1 flex items-center justify-center">
      <div className="animate-pulse text-white/40 font-display text-2xl">
        MAFIA
      </div>
    </div>
  );
}
