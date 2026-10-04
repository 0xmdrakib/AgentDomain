import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const primary = 'AgentDomain is the agent-native identity and communications infrastructure.';
const descriptor = 'Programmable identity and communication infrastructure for AI agents.';
const title = 'Agent-Native Identity and Communications Infrastructure';
const retired =
  /identity infrastructure for the|agent economy|autonomous identity stack|no human required|zero human intervention/i;
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

async function sourceTree(path) {
  const source = await read(path);
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findNodes(tree, predicate) {
  const nodes = [];
  function visit(node) {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return nodes;
}

function jsxText(node) {
  if (ts.isJsxText(node)) return node.text;
  if (ts.isJsxElement(node)) return node.children.map(jsxText).join('');
  if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) {
    return node.expression.text;
  }
  return '';
}

test('homepage leads with both pillars and includes direct, guided, and permissioned use', async () => {
  const tree = await sourceTree('apps/frontend/src/components/landing/hero.tsx');
  const heading = findNodes(
    tree,
    (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'h1',
  );
  assert.equal(heading.length, 1);
  assert.equal(
    normalize(jsxText(heading[0])),
    'Agent-native identity and communications infrastructure',
  );
  const copy = normalize(tree.getFullText());
  assert.ok(copy.includes(descriptor));
  assert.ok(
    copy.includes(
      'developers using APIs and SDKs, people guiding agents, and permissioned autonomous workflows',
    ),
  );
  assert.doesNotMatch(copy, retired);
  const attributes = heading[0].openingElement.attributes.properties;
  const classes = attributes.find(
    (node) => ts.isJsxAttribute(node) && node.name.text === 'className',
  ).initializer.text;
  for (const name of [
    'wrap-anywhere',
    'text-balance',
    'text-3xl',
    'sm:text-5xl',
    'md:text-7xl',
    'tracking-normal',
  ]) {
    assert.ok(classes.split(/\s+/).includes(name), name);
  }
  assert.doesNotMatch(classes, /nowrap|overflow-|truncate|tracking-tight|\b(?:vw|cqw)\b|clamp\(/);
});

test('site, page, wallet, and social definitions stay aligned without changing asset references', async () => {
  const seo = await sourceTree('apps/frontend/src/lib/seo.ts');
  const description = findNodes(
    seo,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(seo) === 'DEFAULT_DESCRIPTION',
  )[0].initializer.text;
  assert.ok(description.startsWith(primary));
  assert.match(
    description,
    /developers, people guiding agents, and permissioned autonomous workflows/,
  );
  for (const path of ['apps/frontend/src/app/layout.tsx', 'apps/frontend/src/app/page.tsx']) {
    const tree = await sourceTree(path);
    assert.ok(
      findNodes(tree, ts.isStringLiteral).some((node) => node.text === title),
      path,
    );
  }
  assert.match(seo.getFullText(), /description: DEFAULT_DESCRIPTION/);
  assert.match(seo.getFullText(), /description: options\.description/);
  const wallet = await sourceTree('apps/frontend/src/lib/wagmi.ts');
  assert.ok(findNodes(wallet, ts.isStringLiteral).some((node) => node.text === descriptor));
  const brand = JSON.parse(await read('apps/frontend/src/lib/brand-assets.json'));
  assert.equal(
    brand.socialImage.alt,
    'AgentDomain - Agent-native identity and communications infrastructure.',
  );
  assert.equal(brand.assets.socialCard, '/brand/web/logo-for-link-embed.jpg');
  assert.equal(brand.assets.socialCardOriginal, '/brand/agentdomain-brand/logo-for-link-embed.png');
});

test('product introductions no longer restrict the product to autonomous agents', async () => {
  for (const path of [
    'apps/frontend/src/components/landing/features.tsx',
    'apps/frontend/src/components/landing/how-it-works.tsx',
    'apps/frontend/src/app/terms/page.tsx',
    'apps/frontend/src/app/registry/page.tsx',
    'packages/sdk/README.md',
    'packages/agentkit-plugin/README.md',
    'packages/eliza-plugin/README.md',
  ]) {
    const copy = normalize(await read(path));
    assert.doesNotMatch(copy, retired, path);
    assert.doesNotMatch(
      copy,
      /provide autonomous AI agents|intended for autonomous agent|Autonomous identity registered/,
      path,
    );
  }
  const solutions = await sourceTree('apps/frontend/src/lib/solution-pages.ts');
  const strings = findNodes(solutions, ts.isStringLiteral).map((node) => node.text);
  assert.ok(strings.includes(primary));
  assert.ok(strings.includes('AI Agent Identity: Persistent Internet Identity for AI Agents'));
  assert.ok(
    strings.some((text) =>
      /Developers can integrate directly.*People can guide agents.*within configured permissions/.test(
        text,
      ),
    ),
  );
  assert.ok(strings.includes('Onchain Agent Identity with AgentID, Basename, and ENS'));
  assert.ok(strings.includes('Autonomous Agent Renewals for Persistent Domains and Identities'));
  assert.ok(
    strings.includes('Email is currently text-only. Rich HTML and attachments are not supported.'),
  );
});

test('full-workflow package metadata names identity and communications; read-only tools remain scoped', async () => {
  for (const name of ['sdk', 'mcp-server', 'agentkit-plugin', 'eliza-plugin']) {
    const manifest = JSON.parse(await read(`packages/${name}/package.json`));
    assert.match(manifest.description, /agent-native identity and communications/);
  }
  const eliza = await sourceTree('packages/eliza-plugin/src/index.ts');
  assert.ok(findNodes(eliza, ts.isStringLiteral).some((node) => node.text === descriptor));
  const langchain = JSON.parse(await read('packages/langchain-plugin/package.json'));
  assert.equal(
    langchain.description,
    'Read-only LangChain tools for AgentDomain identity and renewal observations',
  );
});
