import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const expectedLinks = [
  '/#features',
  '/#how-it-works',
  '/#pricing',
  '/registry',
  '/verify',
  'mailto:contact@agentdomain.app',
  'https://docs.agentdomain.app',
];

function navigationLinks(filename, source) {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const scopes = [];
  function findScope(node) {
    if (
      (ts.isFunctionDeclaration(node) && node.name?.text === 'NavLinks') ||
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'links')
    )
      scopes.push(node);
    ts.forEachChild(node, findScope);
  }
  findScope(tree);
  assert.equal(scopes.length, 1);
  const links = [];
  function collect(node) {
    if (
      (ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) &&
      node.name.getText(tree) === 'href'
    ) {
      assert.ok(node.initializer && ts.isStringLiteral(node.initializer));
      links.push(node.initializer.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(scopes[0]);
  return links;
}

for (const filename of ['nav.tsx', 'public-nav.tsx']) {
  test(`${filename} keeps support text-only in both navigation layouts`, async () => {
    const source = await readFile(
      new URL(`../src/components/landing/${filename}`, import.meta.url),
      'utf8',
    );
    assert.deepEqual(navigationLinks(filename, source), expectedLinks);
    assert.notDeepEqual(
      navigationLinks(filename, source.replace('/verify', '/wrong-route')),
      expectedLinks,
    );
    assert.ok(source.includes('Support'));
    assert.doesNotMatch(source, /<Mail\b/);
    assert.doesNotMatch(source, /import\s*\{[^}]*\bMail\b[^}]*\}\s*from 'lucide-react'/);
    assert.match(source, /<Menu\b/);
    assert.match(source, /<X\b/);
  });
}
