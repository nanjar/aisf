'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [businessIdea, setBusinessIdea] = useState('');
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('');
  const [aiModel, setAiModel] = useState('gpt-5-mini');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const project = await api.createProject({
        name,
        businessIdea,
        knowledgeBaseId: knowledgeBaseId || undefined,
        aiModel,
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.createProjectFailed'));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="font-display text-xs text-inkMuted hover:text-ink">
        {t('newProject.back')}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-ink">{t('newProject.heading')}</h1>
      <p className="mt-1 text-sm text-inkMuted">{t('newProject.subheading')}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label className="mb-1 block text-sm text-inkMuted">{t('newProject.nameLabel')}</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newProject.namePlaceholder')}
            className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink placeholder:text-inkMuted focus:border-track focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-inkMuted">{t('newProject.ideaLabel')}</label>
          <textarea
            required
            rows={5}
            value={businessIdea}
            onChange={(e) => setBusinessIdea(e.target.value)}
            placeholder={t('newProject.ideaPlaceholder')}
            className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink placeholder:text-inkMuted focus:border-track focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm text-inkMuted">{t('newProject.kbLabel')}</label>
            <input
              value={knowledgeBaseId}
              onChange={(e) => setKnowledgeBaseId(e.target.value)}
              placeholder="kb_01"
              className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink placeholder:text-inkMuted focus:border-track focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-inkMuted">{t('newProject.modelLabel')}</label>
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
            >
              <option value="gpt-5-mini">gpt-5-mini</option>
              <option value="gpt-5">gpt-5</option>
              <option value="deepseek-chat">deepseek-chat</option>
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-stop">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-track px-4 py-2.5 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? t('newProject.submitLoading') : t('newProject.submitDefault')}
        </button>
      </form>
    </main>
  );
}
