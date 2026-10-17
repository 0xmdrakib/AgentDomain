import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseContext, releaseContext } from './public-release-identity.mjs';

export const PACKAGES = [
  'shared',
  'sdk',
  'mcp-server',
  'agentkit-plugin',
  'eliza-plugin',
  'langchain-plugin',
];
export const VERSION = '0.11.0';
const BOOTSTRAP_NAME = '@agentdomain/langchain-plugin';
const fail = () => {
  throw new Error('NPM_RELEASE_REFUSED');
};

export function releaseRows(text) {
  const rows = text
    .trimEnd()
    .split('\n')
    .map((line) => line.split('\t'));
  if (rows.length !== PACKAGES.length) fail();
  rows.forEach((row, i) => {
    if (
      JSON.stringify(row) !==
      JSON.stringify([
        `@agentdomain/${PACKAGES[i]}`,
        VERSION,
        `packages/agentdomain-${PACKAGES[i]}-${VERSION}.tgz`,
      ])
    )
      fail();
  });
  return rows;
}

export function publishEnvironment(base) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (/token|password|npm_config_.*auth/i.test(key) && !key.startsWith('ACTIONS_ID_TOKEN_'))
      delete env[key];
  }
  env.NPM_CONFIG_IGNORE_SCRIPTS = 'true';
  env.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org/';
  env.NPM_CONFIG_FETCH_RETRIES = '0';
  return env;
}

export async function publishRelease({ root, npmCli, mode, env, lookup, run }) {
  // Keep the old selector name for LangChain, not its historical token exception.
  if (
    !['oidc', 'bootstrap'].includes(mode) ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ||
    !env.ACTIONS_ID_TOKEN_REQUEST_URL
  )
    fail();
  try {
    assertReleaseContext(releaseContext(env), true, 'publish-npm.yml');
  } catch {
    fail();
  }
  const rows = releaseRows(readFileSync(resolve(root, 'publish-order.tsv'), 'utf8'));
  for (const [name, version, filename] of rows) {
    if ((name === BOOTSTRAP_NAME) !== (mode === 'bootstrap')) continue;
    const archive = resolve(root, filename);
    const existing = await lookup(`${encodeURIComponent(name)}/${version}`);
    if (existing.status === 200) {
      const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
      if (
        existing.body?.name !== name ||
        existing.body?.version !== version ||
        existing.body?.dist?.integrity !== integrity
      )
        fail();
      continue;
    }
    if (existing.status !== 404) fail();
    const childEnv = publishEnvironment(env);
    const result = await run(
      process.execPath,
      [
        npmCli,
        'publish',
        archive,
        '--access',
        'public',
        '--provenance',
        '--ignore-scripts',
        '--registry=https://registry.npmjs.org/',
      ],
      childEnv,
    );
    // A failed/unknown publication is never retried in this invocation.
    if (result !== 0) fail();
  }
}

async function registry(path) {
  const response = await fetch(`https://registry.npmjs.org/${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    return { status: response.status };
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) fail();
    chunks.push(chunk);
  }
  return { status: 200, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  delete process.env.NPM_BOOTSTRAP_TOKEN;
  try {
    await publishRelease({
      root: process.argv[2],
      npmCli: process.argv[3],
      mode: process.argv[4],
      env: process.env,
      lookup: registry,
      run: (command, args, env) =>
        spawnSync(command, args, { env, stdio: 'inherit', timeout: 180_000, shell: false }).status,
    });
  } catch {
    console.error('npm release stopped; verify registry state before any later dispatch.');
    process.exitCode = 1;
  }
}
