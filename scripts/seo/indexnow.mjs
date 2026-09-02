import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEXNOW_LIMITS = Object.freeze({
  timeoutMs: 10_000,
  maxUrls: 100,
  maxChangedPaths: 2_000,
  maxPathBytes: 4_096,
  maxUrlBytes: 2_048,
  maxPayloadBytes: 256 * 1_024,
});

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const COMMIT = /^[0-9a-f]{40}$/;
const KEY = /^[A-Za-z0-9-]{8,128}$/;
const FRONTEND_ROUTES = new Set(['/', '/register', '/registry', '/privacy', '/terms']);
const SITES = {
  frontend: {
    host: 'agentdomain.app',
    fallback: [
      'https://agentdomain.app/',
      'https://agentdomain.app/sitemap.xml',
      'https://agentdomain.app/sitemap-agents.xml',
    ],
  },
  docs: {
    host: 'docs.agentdomain.app',
    fallback: ['https://docs.agentdomain.app/', 'https://docs.agentdomain.app/sitemap-index.xml'],
  },
};

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function siteConfig(site) {
  return SITES[site] ?? fail('INDEXNOW_SITE_INVALID');
}

function validCommit(value) {
  const commit = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!COMMIT.test(commit)) fail('INDEXNOW_COMMIT_INVALID');
  return commit;
}

async function defaultGit(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1_024 * 1_024,
    windowsHide: true,
  });
  return stdout;
}

export async function readIndexNowKey(repositoryRoot = REPOSITORY_ROOT) {
  const directory = join(repositoryRoot, 'apps', 'frontend', 'public');
  const candidates = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const key = entry.name.endsWith('.txt') ? entry.name.slice(0, -4) : '';
    if (!entry.isFile() || !KEY.test(key)) continue;
    const content = (await readFile(join(directory, entry.name), 'utf8')).trim();
    if (content === key) candidates.push({ key, filename: entry.name });
  }
  if (candidates.length !== 1) fail('INDEXNOW_KEY_INVALID');
  return candidates[0];
}

export async function prepareDocsKey(
  outputDirectory = join(REPOSITORY_ROOT, 'apps', 'docs', 'dist'),
) {
  const key = await readIndexNowKey();
  const source = await readFile(join(REPOSITORY_ROOT, 'apps', 'frontend', 'public', key.filename));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, key.filename), source);
  return { filename: key.filename, bytes: source.byteLength };
}

export async function productionContext({
  confirmed,
  explicitCommit,
  environment = process.env,
  git = defaultGit,
} = {}) {
  if (!confirmed) fail('INDEXNOW_PRODUCTION_CONFIRMATION_REQUIRED');
  const workersBuild = environment.WORKERS_CI === '1';
  const hasWorkersContext = [
    environment.WORKERS_CI,
    environment.WORKERS_CI_BRANCH,
    environment.WORKERS_CI_COMMIT_SHA,
  ].some(Boolean);

  let commit;
  if (workersBuild) {
    if (environment.WORKERS_CI_BRANCH !== 'main') fail('INDEXNOW_NON_PRODUCTION_BRANCH');
    commit = validCommit(environment.WORKERS_CI_COMMIT_SHA);
  } else {
    if (hasWorkersContext) fail('INDEXNOW_WORKERS_CONTEXT_INCOMPLETE');
    if (environment.CI && !['0', 'false'].includes(environment.CI)) {
      fail('INDEXNOW_NON_WORKERS_CI_FORBIDDEN');
    }
    commit = explicitCommit
      ? validCommit(explicitCommit)
      : validCommit(await git(['rev-parse', 'HEAD']));
  }

  if (explicitCommit && validCommit(explicitCommit) !== commit) fail('INDEXNOW_COMMIT_MISMATCH');
  if (validCommit(await git(['rev-parse', 'HEAD'])) !== commit) fail('INDEXNOW_COMMIT_MISMATCH');
  const dirty = (await git(['status', '--porcelain=v1', '--untracked-files=normal'])).trim() !== '';
  if (dirty) fail('INDEXNOW_SOURCE_TREE_DIRTY');
  return { commit, source: workersBuild ? 'workers-builds' : 'local' };
}

export async function changedPaths(commit, git = defaultGit) {
  try {
    const output = await git([
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '--no-renames',
      '-r',
      '-z',
      validCommit(commit),
    ]);
    const paths = [
      ...new Set(
        output
          .split('\0')
          .filter(Boolean)
          .map((path) => path.replaceAll('\\', '/')),
      ),
    ];
    if (
      paths.length === 0 ||
      paths.length > INDEXNOW_LIMITS.maxChangedPaths ||
      paths.some((path) => bytes(path) > INDEXNOW_LIMITS.maxPathBytes)
    ) {
      return null;
    }
    return paths.sort();
  } catch {
    return null;
  }
}

function exactRoute(site, path) {
  if (site === 'docs') {
    const match = path.match(/^apps\/docs\/src\/content\/docs\/(.+)\.mdx?$/);
    if (!match) return null;
    const slug = match[1].replace(/\/index$/, '');
    return slug === 'index' ? '/' : `/${slug}/`;
  }

  const match = path.match(/^apps\/frontend\/src\/app\/(.*)page\.tsx$/);
  if (!match || /[([]/.test(match[1])) return null;
  const route = `/${match[1]}`.replace(/\/$/, '') || '/';
  return FRONTEND_ROUTES.has(route) ? route : null;
}

function irrelevant(site, path) {
  if (path.startsWith('.github/') || path.startsWith('scripts/seo/') || path.includes('/test/')) {
    return true;
  }
  if (path.endsWith('README.md')) return true;
  if (site === 'frontend' && path.startsWith('apps/docs/')) return true;
  if (site === 'docs' && path.startsWith('apps/frontend/') && !path.includes('/public/'))
    return true;
  return false;
}

export function planUrls(site, paths) {
  const config = siteConfig(site);
  const exact = [];
  let conservative = !paths?.length;
  for (const path of paths ?? []) {
    const route = exactRoute(site, path);
    if (route) exact.push(new URL(route, `https://${config.host}/`).toString());
    else if (!irrelevant(site, path)) conservative = true;
  }
  let urls = [...new Set(exact)].sort();
  const useFallback = conservative || urls.length === 0 || urls.length > INDEXNOW_LIMITS.maxUrls;
  if (useFallback) {
    urls = [...new Set([...urls.slice(0, INDEXNOW_LIMITS.maxUrls), ...config.fallback])];
  }
  if (urls.length > INDEXNOW_LIMITS.maxUrls) urls = [...config.fallback];
  return { mode: useFallback ? 'conservative' : 'exact', urls };
}

function validateUrls(site, urls) {
  const config = siteConfig(site);
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > INDEXNOW_LIMITS.maxUrls) {
    fail('INDEXNOW_URL_COUNT_INVALID');
  }
  for (const value of urls) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.host !== config.host ||
      url.username ||
      url.password ||
      url.hash ||
      bytes(value) > INDEXNOW_LIMITS.maxUrlBytes
    ) {
      fail('INDEXNOW_URL_INVALID');
    }
  }
}

export async function submit({
  site,
  urls,
  key,
  fetcher = globalThis.fetch,
  timeoutMs = INDEXNOW_LIMITS.timeoutMs,
} = {}) {
  if (!KEY.test(key) || timeoutMs < 1 || timeoutMs > INDEXNOW_LIMITS.timeoutMs) {
    fail('INDEXNOW_SUBMISSION_INVALID');
  }
  const config = siteConfig(site);
  const urlList = [...new Set(urls)];
  validateUrls(site, urlList);
  const body = JSON.stringify({
    host: config.host,
    key,
    keyLocation: `https://${config.host}/${key}.txt`,
    urlList,
  });
  if (bytes(body) > INDEXNOW_LIMITS.maxPayloadBytes) fail('INDEXNOW_PAYLOAD_TOO_LARGE');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    fail(controller.signal.aborted ? 'INDEXNOW_TIMEOUT' : 'INDEXNOW_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
  await response.body?.cancel().catch(() => undefined);
  if (![200, 202].includes(response.status)) fail(`INDEXNOW_HTTP_${response.status}`);
  return { status: response.status, urlCount: urlList.length };
}

export async function runProduction({ site, confirmed, explicitCommit } = {}) {
  const context = await productionContext({ confirmed, explicitCommit });
  const paths = await changedPaths(context.commit);
  const plan = planUrls(site, paths);
  const { key } = await readIndexNowKey();
  const result = await submit({ site, urls: plan.urls, key });
  return {
    site,
    commit: context.commit,
    mode: plan.mode,
    ...result,
    deploymentAlreadySucceeded: true,
  };
}

function parse(argv) {
  const [command, ...flags] = argv;
  const site = flags.find((flag) => flag.startsWith('--site='))?.slice(7);
  const explicitCommit = flags.find((flag) => flag.startsWith('--commit='))?.slice(9);
  const confirmed = flags.includes('--production');
  const known = flags.every(
    (flag) => flag === '--production' || flag.startsWith('--site=') || flag.startsWith('--commit='),
  );
  if (!known || !['prepare-key', 'verify', 'submit'].includes(command)) {
    fail('INDEXNOW_ARGUMENT_INVALID');
  }
  siteConfig(site);
  if (command === 'prepare-key' && (site !== 'docs' || confirmed || explicitCommit)) {
    fail('INDEXNOW_ARGUMENT_INVALID');
  }
  if (command === 'submit' && !confirmed) fail('INDEXNOW_PRODUCTION_CONFIRMATION_REQUIRED');
  return { command, site, confirmed, explicitCommit };
}

async function main() {
  const args = parse(process.argv.slice(2));
  const result =
    args.command === 'prepare-key'
      ? await prepareDocsKey()
      : args.command === 'verify'
        ? await productionContext({
            confirmed: args.confirmed,
            explicitCommit: args.explicitCommit,
          })
        : await runProduction({
            site: args.site,
            confirmed: args.confirmed,
            explicitCommit: args.explicitCommit,
          });
  console.log(JSON.stringify({ event: `indexnow_${args.command}`, ...result }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const deploymentAlreadySucceeded = process.argv[2] === 'submit';
    console.error(
      JSON.stringify({
        event: deploymentAlreadySucceeded
          ? 'indexnow_post_deploy_failed'
          : 'indexnow_predeploy_failed',
        code: error?.code ?? 'INDEXNOW_UNEXPECTED',
        deploymentAlreadySucceeded,
      }),
    );
    process.exitCode = 1;
  });
}
