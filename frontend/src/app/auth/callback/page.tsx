'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/api';

// V1.1: backend (AuthController.googleCallback) redirect ke sini dengan
// #accessToken=... di URL fragment (bukan cookie httpOnly) — konsisten dengan
// pola auth existing (JWT di localStorage).
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('accessToken');

    if (token) {
      setToken(token);
      router.replace('/');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <p className="font-display text-sm text-inkMuted">Menyelesaikan login…</p>
    </main>
  );
}
