'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import BrandHeader from '@/components/BrandHeader';

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
      <div className="animate-fade-in">
        <div className="animate-pulse-soft">
          <BrandHeader small />
        </div>
      </div>
    </div>
  );
}
