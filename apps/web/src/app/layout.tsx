import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://agentdomain.xyz'),
  title: {
    default: 'AgentDomain - Identity Infrastructure for AI Agents',
    template: '%s | AgentDomain',
  },
  description:
    'The autonomous identity stack for AI agents. Domain + Basename + DNS + Email + SSL in one transaction on Base. Pay in USDC, no human required.',
  keywords: [
    'AI agents',
    'agent identity',
    'Web3',
    'Base',
    'x402',
    'Basenames',
    'Basenames',
    'autonomous agents',
  ],
  authors: [{ name: 'AgentDomain' }],
  openGraph: {
    title: 'AgentDomain - Identity Infrastructure for AI Agents',
    description: 'Domain + Basename + DNS + Email + SSL in one transaction on Base.',
    type: 'website',
    url: 'https://agentdomain.xyz',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentDomain',
    description: 'The autonomous identity stack for AI agents.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" theme="light" richColors />
      </body>
    </html>
  );
}
