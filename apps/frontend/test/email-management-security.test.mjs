import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(
  new URL('../src/components/agents/email-management.tsx', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'email-management.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

test('reviewed email fetch sinks remain in client event handlers, never server actions or render', () => {
  assert.equal(ast.statements[0].expression.text, 'use client');
  assert.doesNotMatch(source, /['"]use server['"]/);
  const handlers = new Map();
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ['updateRead', 'mutateAddress'].includes(node.name?.text)
    ) {
      handlers.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(handlers.size, 2);
  for (const handler of handlers.values()) {
    assert.ok(handler.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
    assert.match(handler.getText(ast), /await ensureSignedIn\(\)/);
    assert.match(
      handler.getText(ast),
      /\/\/ nosemgrep: nodejs_scan\.javascript-ssrf-rule-node_ssrf\s+const res = await fetch/,
    );
  }
  assert.match(handlers.get('updateRead').getText(ast), /fetch\(`\/api\/v1\/agents\//);
  assert.match(
    handlers.get('mutateAddress').getText(ast),
    /const transport = addressMutationRequest\(agentId, request\)/,
  );
  assert.match(source, /onClick=\{\(\) => updateRead\(/);
  assert.match(source, /onClick=\{\(\) => mutateAddress\(/);
  assert.equal((source.match(/nosemgrep:/g) ?? []).length, 2);
});

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = await build({
  stdin: {
    contents:
      'export { EmailManagement } from "./src/components/agents/email-management"; export { addressMutationRequest } from "./src/lib/email-address-lifecycle";',
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [
    {
      name: 'authenticated-session-fixture',
      setup(build) {
        build.onResolve({ filter: /hooks\/use-siwe$/ }, () => ({
          path: 'session',
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const useSiwe = () => ({ session: { authenticated: true, address: "0x1111111111111111111111111111111111111111" }, signIn: async () => true, loading: false });',
          loader: 'js',
        }));
      },
    },
  ],
});
const compiledModule = { exports: {} };
let fetchCalls = 0;
runInNewContext(bundle.outputFiles[0].text, {
  module: compiledModule,
  exports: compiledModule.exports,
  require,
  URL,
  URLSearchParams,
  AbortSignal,
  fetch: () => {
    fetchCalls++;
    throw new Error('Email handlers must not fetch during server prerender');
  },
});

test('authenticated email component server prerender does not execute browser fetches', () => {
  const html = renderToStaticMarkup(
    createElement(compiledModule.exports.EmailManagement, {
      agentId: '00000000-0000-4000-8000-000000000001',
      inbox: { emailAddress: 'agent@example.test' },
    }),
  );
  assert.ok(html.length > 0);
  assert.equal(fetchCalls, 0);
});

test('address mutations keep attacker-like IDs and email targets in the same-origin path/query', () => {
  for (const action of ['primary-rename', 'alias-create', 'alias-delete']) {
    const agentId = 'https://169.254.169.254/metadata?x=1#fragment';
    const target = 'alias+tag@example.test';
    const requestId = '00000000-0000-4000-8000-000000000002';
    const transport = compiledModule.exports.addressMutationRequest(agentId, {
      action,
      target,
      requestId,
    });
    const url = new URL(transport.url, 'https://frontend.example.test');
    assert.equal(url.origin, 'https://frontend.example.test');
    assert.equal(
      url.pathname,
      `/api/v1/agents/${encodeURIComponent(agentId)}/email` +
        (action === 'primary-rename' ? '' : '/aliases'),
    );
    assert.equal(url.hash, '');
    assert.equal(transport.init.credentials, 'include');
    assert.equal(transport.init.headers['Idempotency-Key'], requestId);
    if (action === 'alias-delete') assert.equal(url.searchParams.get('emailAddress'), target);
  }
});
