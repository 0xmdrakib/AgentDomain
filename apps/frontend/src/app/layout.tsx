import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { BRAND_ICONS } from '@/lib/brand-assets';
import {
  brandedTitle,
  DEFAULT_DESCRIPTION,
  SITE_URL,
  SOCIAL_IMAGE,
  TITLE_TEMPLATE,
} from '@/lib/seo';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const socialTitle = brandedTitle('Identity Infrastructure for AI Agents');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: socialTitle,
    template: TITLE_TEMPLATE,
  },
  description: DEFAULT_DESCRIPTION,
  authors: [{ name: 'AgentDomain' }],
  icons: BRAND_ICONS,
  openGraph: {
    title: socialTitle,
    description: DEFAULT_DESCRIPTION,
    siteName: 'AgentDomain',
    type: 'website',
    url: SITE_URL,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: socialTitle,
    description: DEFAULT_DESCRIPTION,
    images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
  },
  other: {
    'base:app_id': '696f2cefc0ab25addaaaf751',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
