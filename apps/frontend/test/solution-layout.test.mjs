import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function elements(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const attributes = new Map(
        node.openingElement.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [attribute.name.getText(tree), attribute.initializer]),
      );
      const className = attributes.get('className');
      result.push({
        tag: node.openingElement.tagName.getText(tree),
        classes: className && ts.isStringLiteral(className) ? className.text.split(/\s+/) : [],
        attributes,
        children: node.children,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

test('solution content and code can shrink inside mobile and desktop grid tracks', async () => {
  const nodes = await elements('../src/components/seo/solution-page.tsx');
  const grid = nodes.find((node) => node.tag === 'section' && node.classes.includes('grid'));
  assert.ok(grid.classes.includes('grid-cols-1'));
  assert.ok(grid.classes.includes('lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]'));
  const aside = nodes.find((node) => node.tag === 'aside');
  assert.ok(aside.classes.includes('min-w-0'));
  const pre = nodes.find((node) => node.tag === 'pre');
  assert.ok(pre.classes.includes('max-w-full'));
  assert.ok(pre.classes.includes('mobile-scroll'));
  assert.equal(pre.attributes.get('tabIndex')?.expression?.text, '0');
  assert.equal(pre.attributes.get('role')?.text, 'region');
  assert.ok(pre.attributes.has('aria-label'));
  assert.ok(nodes.find((node) => node.tag === 'h1').classes.includes('wrap-anywhere'));
});

test('pricing highlights only every domain using the established feature heading style', async () => {
  const pricing = await elements('../src/components/landing/pricing.tsx');
  const features = await elements('../src/components/landing/features.tsx');
  const heading = pricing.find((node) => node.tag === 'h2');
  const featureHeading = features.find((node) => node.tag === 'h2');
  assert.deepEqual(heading.classes, featureHeading.classes);
  const highlights = pricing.filter((node) => node.classes.includes('gradient-text'));
  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].tag, 'span');
  assert.equal(highlights[0].children.length, 1);
  assert.ok(ts.isJsxText(highlights[0].children[0]));
  assert.equal(highlights[0].children[0].text, 'every domain');
  assert.deepEqual(highlights[0].classes, ['gradient-text']);
});
