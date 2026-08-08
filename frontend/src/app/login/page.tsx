'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
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
      setError(err instanceof ApiError ? err.message : t('error.loginFailed'));
    } finally {
      setLoading(false);
    }
  }
  function handleGoogleLogin() {
    window.location.href = api.googleLoginUrl();
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-panelBorder bg-panel p-8">
        <p className="font-display text-xs uppercase tracking-widest text-track">AI Software Factory</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">{t('login.heading')}</h1>
        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-inkMuted">{t('login.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-inkMuted">{t('login.password')}</label>
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
          {loading ? t('login.submitLoading') : t('login.submitDefault')}
        </button>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-panelBorder" />
          <span className="font-display text-[11px] uppercase tracking-widest text-inkMuted">
            {t('login.or')}
          </span>
          <div className="h-px flex-1 bg-panelBorder" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-panelBorder bg-floor px-4 py-2 text-sm font-medium text-ink transition hover:border-track/50"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"
            />
            <path
              fill="#FF3D00"
              d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5c-7.7 0-14.4 4.4-17.7 10.8z"
            />
            <path
              fill="#4CAF50"
              d="M24 44.5c5.4 0 10.3-1.8 14.1-5l-6.5-5.5c-2 1.4-4.6 2.3-7.6 2.3-5.3 0-9.7-3.3-11.3-7.9l-6.6 5.1C9.5 40 16.2 44.5 24 44.5z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.5 5.5c-.5.4 6.9-5 6.9-15.2 0-1.2-.1-2.4-.3-3.5z"
            />
          </svg>
          {t('login.google')}
        </button>
      </form>
    </main>
  );
}
