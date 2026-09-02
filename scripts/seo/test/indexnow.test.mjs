import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  INDEXNOW_LIMITS,
  REPOSITORY_ROOT,
  changedPaths,
  planUrls,
  prepareDocsKey,
  productionContext,
  readIndexNowKey,
  submit,
} from '../indexnow.mjs';

const SHA = 'a'.repeat(40);
const git = (responses) => async (args) => responses[args.join(' ')] ?? '';
const rejects = (code, operation) => assert.rejects(operation, (error) => error?.code === code);

test('existing public key is reused and copied byte-for-byte to docs output', async (context) => {
  const output = await mkdtemp(join(tmpdir(), 'agentdomain-indexnow-'));
  context.after(() => rm(output, { recursive: true, force: true }));
  const key = await readIndexNowKey();
  const result = await prepareDocsKey(output);
  assert.equal(result.filename, `${key.key}.txt`);
  assert.equal(
    await readFile(join(output, key.filename), 'utf8'),
    await readFile(join(REPOSITORY_ROOT, 'apps', 'frontend', 'public', key.filename), 'utf8'),
  );
});

test('only main Workers Builds or explicit local production can submit', async () => {
  const workers = await productionContext({
    confirmed: true,
    environment: {
      CI: 'true',
      WORKERS_CI: '1',
      WORKERS_CI_BRANCH: 'main',
      WORKERS_CI_COMMIT_SHA: SHA,
    },
    git: git({
      'rev-parse HEAD': SHA,
      'status --porcelain=v1 --untracked-files=normal': '',
    }),
  });
  assert.deepEqual(workers, { commit: SHA, source: 'workers-builds' });

  await rejects('INDEXNOW_NON_PRODUCTION_BRANCH', () =>
    productionContext({
      confirmed: true,
      environment: {
        WORKERS_CI: '1',
        WORKERS_CI_BRANCH: 'preview',
        WORKERS_CI_COMMIT_SHA: SHA,
      },
      git: async () => SHA,
    }),
  );
  await rejects('INDEXNOW_NON_WORKERS_CI_FORBIDDEN', () =>
    productionContext({ confirmed: true, environment: { CI: 'true' }, git: async () => SHA }),
  );
  await rejects('INDEXNOW_PRODUCTION_CONFIRMATION_REQUIRED', () =>
    productionContext({ environment: {}, git: async () => SHA }),
  );

  await rejects('INDEXNOW_SOURCE_TREE_DIRTY', () =>
    productionContext({
      confirmed: true,
      environment: {},
      git: git({
        'rev-parse HEAD': SHA,
        'status --porcelain=v1 --untracked-files=normal': ' M apps/frontend/package.json',
      }),
    }),
  );
  const local = await productionContext({
    confirmed: true,
    environment: {},
    git: git({
      'rev-parse HEAD': SHA,
      'status --porcelain=v1 --untracked-files=normal': '',
    }),
  });
  assert.deepEqual(local, { commit: SHA, source: 'local' });
});

test('changed paths are bounded and collected without rename inference', async () => {
  const args = `diff-tree --root --no-commit-id --name-only --no-renames -r -z ${SHA}`;
  assert.deepEqual(
    await changedPaths(
      SHA,
      git({
        [args]:
          'apps/docs/src/content/docs/quickstart.mdx\0apps/frontend/src/app/privacy/page.tsx\0',
      }),
    ),
    ['apps/docs/src/content/docs/quickstart.mdx', 'apps/frontend/src/app/privacy/page.tsx'],
  );
  assert.equal(await changedPaths(SHA, git({ [args]: '' })), null);
});

test('exact pages are selected while ambiguous changes use roots and sitemaps', () => {
  assert.deepEqual(
    planUrls('frontend', [
      'apps/frontend/src/app/page.tsx',
      'apps/frontend/src/app/privacy/page.tsx',
      'apps/frontend/test/isolation.test.mjs',
    ]),
    {
      mode: 'exact',
      urls: ['https://agentdomain.app/', 'https://agentdomain.app/privacy'],
    },
  );
  assert.deepEqual(planUrls('docs', ['apps/docs/src/content/docs/guides/dns.mdx']), {
    mode: 'exact',
    urls: ['https://docs.agentdomain.app/guides/dns/'],
  });
  assert.deepEqual(planUrls('docs', ['apps/docs/src/styles/docs.css']), {
    mode: 'conservative',
    urls: ['https://docs.agentdomain.app/', 'https://docs.agentdomain.app/sitemap-index.xml'],
  });
});

test('one bounded POST is deduplicated, same-host, and never reads the response body', async () => {
  let request;
  let calls = 0;
  let bodyReads = 0;
  const result = await submit({
    site: 'docs',
    urls: ['https://docs.agentdomain.app/', 'https://docs.agentdomain.app/'],
    key: 'b'.repeat(64),
    fetcher: async (url, init) => {
      calls++;
      request = { url, init, body: JSON.parse(init.body) };
      return {
        status: 202,
        body: { cancel: async () => undefined, text: async () => bodyReads++ },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(bodyReads, 0);
  assert.equal(request.url, 'https://api.indexnow.org/indexnow');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.body.host, 'docs.agentdomain.app');
  assert.equal(request.body.keyLocation, `https://docs.agentdomain.app/${'b'.repeat(64)}.txt`);
  assert.deepEqual(result, { status: 202, urlCount: 1 });
});

test('HTTP failures and timeouts are visible and never retried', async () => {
  let calls = 0;
  await rejects('INDEXNOW_HTTP_500', () =>
    submit({
      site: 'frontend',
      urls: ['https://agentdomain.app/'],
      key: 'c'.repeat(64),
      fetcher: async () => {
        calls++;
        return { status: 500, body: { cancel: async () => undefined } };
      },
    }),
  );
  assert.equal(calls, 1);

  calls = 0;
  await rejects('INDEXNOW_TIMEOUT', () =>
    submit({
      site: 'frontend',
      urls: ['https://agentdomain.app/'],
      key: 'd'.repeat(64),
      timeoutMs: 5,
      fetcher: async (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        );
      },
    }),
  );
  assert.equal(calls, 1);
});

test('package commands run IndexNow only after production deploys', async () => {
  const frontend = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, 'apps', 'frontend', 'package.json'), 'utf8'),
  );
  const docs = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, 'apps', 'docs', 'package.json'), 'utf8'),
  );
  assert.match(
    frontend.scripts.deploy,
    /indexnow\.mjs verify.*--production.*deploy --env=\"\".*indexnow\.mjs submit.*--production/,
  );
  assert.doesNotMatch(frontend.scripts.preview, /indexnow\.mjs submit/);
  assert.match(docs.scripts.build, /indexnow\.mjs prepare-key --site=docs/);
  assert.match(
    docs.scripts.deploy,
    /indexnow\.mjs verify.*--production.*wrangler deploy.*indexnow\.mjs submit.*--production/,
  );
  assert.doesNotMatch(docs.scripts.preview, /indexnow\.mjs submit/);
});

test('local bounds stay well below the protocol maximum', () => {
  assert.deepEqual(INDEXNOW_LIMITS, {
    timeoutMs: 10_000,
    maxUrls: 100,
    maxChangedPaths: 2_000,
    maxPathBytes: 4_096,
    maxUrlBytes: 2_048,
    maxPayloadBytes: 256 * 1_024,
  });
});
