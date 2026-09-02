import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { productionContext } from '../../../scripts/seo/indexnow.mjs';

const WALLETCONNECT_PROJECT_ID = /^[A-Za-z0-9_-]{20,128}$/;
const TURNSTILE_SITE_KEY = /^[A-Za-z0-9._-]{10,128}$/;
const PRODUCTION_API = 'https://api.agentdomain.app/api/v1';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export function validateFrontendProductionEnvironment(environment = process.env) {
  if (!WALLETCONNECT_PROJECT_ID.test(environment.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '')) {
    fail('FRONTEND_WALLETCONNECT_CONFIG_REQUIRED');
  }
  if (!TURNSTILE_SITE_KEY.test(environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '')) {
    fail('FRONTEND_TURNSTILE_CONFIG_REQUIRED');
  }

  let api;
  try {
    api = new URL(environment.FRONTEND_PUBLIC_API_URL ?? '');
  } catch {
    fail('FRONTEND_PUBLIC_API_CONFIG_INVALID');
  }
  if (api.href !== PRODUCTION_API || api.username || api.password || api.search || api.hash) {
    fail('FRONTEND_PUBLIC_API_CONFIG_INVALID');
  }
  return Object.freeze({ api: PRODUCTION_API, walletConnect: true, turnstile: true });
}

export async function verifyFrontendProductionRelease({ environment = process.env, git } = {}) {
  const context = await productionContext({ confirmed: true, environment, git });
  validateFrontendProductionEnvironment(environment);
  return Object.freeze({ ...context, configurationVerified: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyFrontendProductionRelease()
    .then((result) =>
      console.log(JSON.stringify({ event: 'frontend_production_release_verified', ...result })),
    )
    .catch((error) => {
      console.error(
        JSON.stringify({
          event: 'frontend_production_release_blocked',
          code: error?.code ?? 'FRONTEND_PRODUCTION_RELEASE_UNEXPECTED',
        }),
      );
      process.exitCode = 1;
    });
}
