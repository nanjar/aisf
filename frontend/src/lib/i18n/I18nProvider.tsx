'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Lang = 'id' | 'en';

type Dictionary = Record<string, unknown>;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const STORAGE_KEY = 'asf_lang';

function getFromDictionary(dict: Dictionary, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[segment];
    return undefined;
  }, dict);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? `{{${name}}}`));
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * BUGFIX (bahasa tidak konsisten): this provider is the piece that was
 * entirely missing. The backend's GET /i18n/:lang has worked correctly
 * since V1.1 — nothing in the frontend ever called it. This:
 *   1. Reads the saved preference from localStorage (defaults to "id").
 *   2. Fetches that dictionary from the backend on mount and on every
 *      language change — this is the actual fix for "switched to English
 *      but the page still shows Indonesian": before this, no fetch ever
 *      happened, so there was no dictionary to switch to in the first place.
 *   3. Applies the change immediately (no logout/reload), matching V1.1 §5.1.
 *   4. Best-effort persists the choice to the backend (fire-and-forget —
 *      never blocks the UI switch on network latency).
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('id');
  const [dictionary, setDictionary] = useState<Dictionary>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Lang | null;
    if (saved === 'id' || saved === 'en') setLangState(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    fetch(`${API_URL}/i18n/${lang}`)
      .then((res) => {
        if (!res.ok) throw new Error(`i18n fetch failed: ${res.status}`);
        return res.json();
      })
      .then((dict: Dictionary) => {
        if (!cancelled) {
          setDictionary(dict);
          setReady(true);
        }
      })
      .catch(() => {
        // Network hiccup: keep whatever dictionary we already have rather
        // than blanking the UI — worst case, text stays in the previous
        // language until the next successful fetch.
        if (!cancelled) setReady(true);
      });

    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }

    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
      const token = localStorage.getItem('asf_token');
      if (token) {
        // Fire-and-forget persistence — see AuthController.updateLanguage.
        fetch(`${API_URL}/auth/me/language`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lang: next }),
        }).catch(() => {
          /* non-fatal — local switch already applied */
        });
      }
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const value = getFromDictionary(dictionary, key);
      if (value === undefined) return key; // visible fallback beats a blank UI
      return interpolate(value, vars);
    },
    [dictionary],
  );

  const value = useMemo(() => ({ lang, setLang, t, ready }), [lang, setLang, t, ready]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
