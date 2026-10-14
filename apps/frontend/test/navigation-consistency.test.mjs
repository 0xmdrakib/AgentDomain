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

const expectedIcons = [
  'PanelsTopLeft',
  'Workflow',
  'CircleDollarSign',
  'LibraryBig',
  'BadgeCheck',
  'Headset',
  'BookOpen',
];

function navigationIcons(filename, source) {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const icons = [];
  function collect(node, inLinks = false) {
    const scope =
      inLinks ||
      (ts.isFunctionDeclaration(node) && node.name?.text === 'NavLinks') ||
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'links');
    if (scope && ts.isPropertyAssignment(node) && node.name.getText(tree) === 'icon') {
      assert.ok(ts.isIdentifier(node.initializer));
      icons.push(node.initializer.text);
    }
    if (scope && ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(tree);
      icons.push(name);
      const attributes = new Map(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [attribute.name.getText(tree), attribute.initializer]),
      );
      assert.ok(attributes.has('aria-hidden'), `${name} must be decorative`);
      assert.equal(attributes.get('className')?.text, 'h-4 w-4 shrink-0');
      assert.equal(attributes.get('strokeWidth')?.getText(tree), '{1.75}');
    }
    ts.forEachChild(node, (child) => collect(child, scope));
  }
  collect(tree);
  return icons;
}

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
  test(`${filename} keeps routes and matching decorative icons in both navigation layouts`, async () => {
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
    assert.deepEqual(navigationIcons(filename, source), expectedIcons);
    assert.notDeepEqual(
      navigationIcons(filename, source.replaceAll('BadgeCheck', 'BookOpen')),
      expectedIcons,
    );
    assert.equal((source.match(/<LayoutDashboard\b/g) ?? []).length, 2);
    if (filename === 'public-nav.tsx') {
      assert.equal((source.match(/<UserRoundPlus\b/g) ?? []).length, 2);
      assert.equal((source.match(/<Icon\b[^>]*aria-hidden/g) ?? []).length, 2);
    }
    assert.match(source, /<Menu\b/);
    assert.match(source, /<X\b/);
  });

  test(`${filename} keeps the mobile menu toggle square without the taller touch-target override`, async () => {
    const source = await readFile(
      new URL(`../src/components/landing/${filename}`, import.meta.url),
      'utf8',
    );
    const tree = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const toggles = [];
    function collect(node) {
      if (
        ts.isJsxOpeningElement(node) &&
        ['summary', 'button'].includes(node.tagName.getText(tree))
      ) {
        const attributes = new Map(
          node.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => [attribute.name.getText(tree), attribute.initializer]),
        );
        const label = attributes.get('aria-label');
        if (
          node.tagName.getText(tree) === 'summary' ||
          (label && ts.isStringLiteral(label) && label.text === 'Toggle navigation')
        ) {
          const className = attributes.get('className');
          assert.ok(className && ts.isStringLiteral(className));
          toggles.push(className.text.split(/\s+/));
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(tree);
    assert.equal(toggles.length, 1);
    for (const token of ['h-10', 'w-10', 'shrink-0']) assert.ok(toggles[0].includes(token));
    assert.ok(!toggles[0].includes('touch-target'));
  });
}
