'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface InvitationInfo {
  email: string;
  role: string;
  organizationName: string;
  needsCredentials: boolean;
}

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/invitations/${params.token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? 'Undangan tidak valid.');
        }
        return res.json();
      })
      .then((data: InvitationInfo) => setInfo(data))
      .catch((err) => setError(err.message));
  }, [params.token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/invitations/${params.token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info?.needsCredentials ? { name, password } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.message ?? 'Gagal menerima undangan.');
      }
      const { accessToken } = await res.json();
      setToken(accessToken);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-lg border border-panelBorder bg-panel p-8 text-center">
          <p className="text-sm text-stop">{error}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-inkMuted">{t('dashboard.loading')}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleAccept} className="w-full max-w-sm rounded-lg border border-panelBorder bg-panel p-8">
        <p className="font-display text-xs uppercase tracking-widest text-track">AI Software Factory</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Undangan bergabung</h1>
        <p className="mt-2 text-sm text-inkMuted">
          Kamu diundang bergabung ke <span className="text-ink">{info.organizationName}</span> sebagai{' '}
          <span className="text-ink">{info.role}</span>.
        </p>
        <p className="mt-1 font-display text-xs text-inkMuted">{info.email}</p>

        {info.needsCredentials && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm text-inkMuted">Nama</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-inkMuted">Buat Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-md bg-track px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Memproses…' : 'Terima Undangan'}
        </button>
      </form>
    </main>
  );
}
