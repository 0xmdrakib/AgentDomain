import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const expectedMcpLink = 'https://docs.agentdomain.app/sdk/mcp/';
const footerUrl = new URL('../src/components/landing/footer.tsx', import.meta.url);

function mcpFooterLinks(source) {
  const tree = ts.createSourceFile(
    'footer.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const scopes = tree.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Footer',
  );
  assert.equal(scopes.length, 1);
  const links = [];
  function collect(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'a') {
      const label = node.children
        .filter(ts.isJsxText)
        .map((child) => child.text)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (label === 'MCP integration') {
        const href = node.openingElement.attributes.properties.find(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'href',
        );
        assert.ok(href?.initializer && ts.isStringLiteral(href.initializer));
        links.push(href.initializer.text);
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(scopes[0]);
  return links;
}

test('shared responsive footer links MCP integration to the exact published docs target', async () => {
  const source = await readFile(footerUrl, 'utf8');
  assert.deepEqual(mcpFooterLinks(source), [expectedMcpLink]);
});

test('footer link regression rejects the old route and URL lookalikes', async () => {
  const source = await readFile(footerUrl, 'utf8');
  for (const href of [
    '/integrations/mcp',
    'https://docs.agentdomain.app.invalid/sdk/mcp/',
    'https://example.invalid/?next=https://docs.agentdomain.app/sdk/mcp/',
    'https://docs.agentdomain.app/sdk/mcp/extra',
    'https://docs.agentdomain.app/sdk/mcp/?redirect=1',
  ]) {
    const changedSource = source.replace(`href="${expectedMcpLink}"`, `href="${href}"`);
    assert.deepEqual(mcpFooterLinks(changedSource), [href]);
    assert.notDeepEqual(mcpFooterLinks(changedSource), [expectedMcpLink]);
  }
});
