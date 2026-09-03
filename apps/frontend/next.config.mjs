import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import { config as loadEnvironment } from 'dotenv';

loadEnvironment({
  path: fileURLToPath(new URL('../../frontend.env', import.meta.url)),
  override: false,
});

const brandConfig = JSON.parse(
  readFileSync(new URL('./src/lib/brand-assets.json', import.meta.url), 'utf8'),
);

const scriptSources = ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'];
if (process.env.NODE_ENV !== 'production') scriptSources.push("'unsafe-eval'");

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src ${scriptSources.join(' ')}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://upload.wikimedia.org https://rabby.io https://*.ipfs.dweb.link https://ipfs.io https://gateway.lighthouse.storage",
      "connect-src 'self' https://mainnet.base.org https://challenges.cloudflare.com https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.coinbase.com https://*.wallet.coinbase.com",
      "frame-src 'self' https://secure.walletconnect.com https://verify.walletconnect.com https://verify.walletconnect.org https://*.walletconnect.com https://*.walletconnect.org https://keys.coinbase.com https://*.coinbase.com https://*.wallet.coinbase.com https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
];

const previewHeaders = [
  {
    key: 'X-Robots-Tag',
    value: 'noindex, nofollow',
  },
];

initOpenNextCloudflareForDev();

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: ['@agentdomain/sdk', '@agentdomain/shared'],
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
  experimental: {
    inlineCss: true,
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    qualities: [75, 100],
    remotePatterns: [
      { protocol: 'https', hostname: '**.ipfs.dweb.link' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'gateway.lighthouse.storage' },
    ],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: '(?:[a-z0-9-]+-)?agentdomain-frontend-preview\\.[a-z0-9-]+\\.workers\\.dev',
          },
        ],
        headers: previewHeaders,
      },
    ];
  },
  async redirects() {
    return [
      ...Object.entries(brandConfig.legacyAliases).map(([source, asset]) => ({
        source,
        destination: brandConfig.assets[asset],
        permanent: true,
      })),
    ];
  },
};

export default nextConfig;
