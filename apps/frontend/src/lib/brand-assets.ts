import brand from './brand-assets.json';

export const BRAND_ASSETS = brand.assets;

export const BRAND_SOCIAL_IMAGE = {
  url: BRAND_ASSETS.socialCard,
  ...brand.socialImage,
} as const;

export const BRAND_ICONS = {
  icon: [
    { url: BRAND_ASSETS.faviconIco, type: 'image/x-icon', sizes: '16x16 32x32 48x48 96x96' },
    { url: BRAND_ASSETS.favicon, type: 'image/png', sizes: '96x96' },
    { url: BRAND_ASSETS.favicon32, type: 'image/png', sizes: '32x32' },
    { url: BRAND_ASSETS.favicon16, type: 'image/png', sizes: '16x16' },
  ],
  shortcut: BRAND_ASSETS.faviconIco,
  apple: [{ url: BRAND_ASSETS.appleTouchIcon, type: 'image/png', sizes: '180x180' }],
};
