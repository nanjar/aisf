'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await api.login(email, password);
      setToken(accessToken);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal masuk. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-panelBorder bg-panel p-8">
        <p className="font-display text-xs uppercase tracking-widest text-track">AI Software Factory</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Masuk ke ruang kendali</h1>

        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-inkMuted">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-inkMuted">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-stop">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-md bg-track px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}
