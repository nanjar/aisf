'use client';

import { useI18n, type Lang } from '@/lib/i18n';

const LANGS: Lang[] = ['id', 'en'];

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();

  return (
    <div className="flex items-center gap-1 rounded-md border border-panelBorder bg-panel p-1 font-display text-[11px]">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`rounded px-2 py-1 uppercase transition ${
            lang === l ? 'bg-track text-floor' : 'text-inkMuted hover:text-ink'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
