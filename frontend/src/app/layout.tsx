import type { Metadata } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '500', '700'] });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'AI Software Factory',
  // BUGFIX: this description was hardcoded Indonesian and renders before any
  // client code runs, so it can never follow the language switch — metadata
  // is inherently server-rendered. Left as the default-language fallback;
  // true localized <title>/meta would need a server-side read of a language
  // cookie, which is a separate follow-up beyond this bugfix.
  description: 'Kendalikan pipeline AI Software Factory dari satu tempat.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${mono.variable} ${sans.variable}`}>
      <body className="min-h-screen bg-floor font-body text-ink antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
