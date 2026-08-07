'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { API_URL } from './api';

const LANG_KEY = 'asf_lang';
export type Lang = 'id' | 'en';

type Dictionary = Record<string, unknown>;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getStoredLang(): Lang {
  if (typeof window === 'undefined') return 'id';
  const stored = localStorage.getItem(LANG_KEY);
  return stored === 'en' ? 'en' : 'id';
}

function resolve(dict: Dictionary, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), dict);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

/**
 * V1.1: penyedia terjemahan. Bahasa disimpan di localStorage (client-side saja — lihat
 * README-INTEGRATION-FRONTEND.md untuk kenapa tidak perlu kolom database), diambil dari
 * GET /i18n/:lang di backend saat pertama load & setiap kali bahasa diganti.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('id');
  const [dict, setDict] = useState<Dictionary>({});
  const [ready, setReady] = useState(false);

  const load = useCallback(async (nextLang: Lang) => {
    try {
      const res = await fetch(`${API_URL}/i18n/${nextLang}`);
      if (!res.ok) throw new Error('i18n fetch failed');
      setDict(await res.json());
    } catch {
      // Gagal diam-diam — t() akan fallback ke key mentah, UI tetap jalan.
      setDict({});
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const initial = getStoredLang();
    setLangState(initial);
    load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      if (typeof window !== 'undefined') localStorage.setItem(LANG_KEY, next);
      load(next);
    },
    [load],
  );

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      const value = resolve(dict, path);
      return value ? interpolate(value, vars) : path;
    },
    [dict],
  );

  return <I18nContext.Provider value={{ lang, setLang, t, ready }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n() harus dipakai di dalam <I18nProvider>');
  return ctx;
}
