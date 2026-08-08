'use client';

import { useI18n } from '@/lib/i18n/I18nProvider';

const LANGS = [
  { code: 'id', label: 'ID' },
  { code: 'en', label: 'EN' },
] as const;

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="flex items-center gap-1 rounded-full border border-panelBorder bg-panel p-0.5">
      <span className="sr-only">{t('setting.language')}</span>
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-full px-2.5 py-1 font-display text-[11px] transition ${
            lang === code ? 'bg-track text-floor' : 'text-inkMuted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
