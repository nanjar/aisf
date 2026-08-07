import type { Metadata } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '500', '700'] });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'AI Software Factory',
  description: 'Kendalikan pipeline AI Software Factory dari satu tempat.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${mono.variable} ${sans.variable}`}>
      <body className="min-h-screen bg-floor font-body text-ink antialiased">{children}</body>
    </html>
  );
}
