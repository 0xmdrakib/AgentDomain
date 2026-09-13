import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const filename of ['nav.tsx', 'public-nav.tsx']) {
  test(`${filename} keeps support text-only in both navigation layouts`, async () => {
    const source = await readFile(
      new URL(`../src/components/landing/${filename}`, import.meta.url),
      'utf8',
    );
    assert.ok(source.includes('mailto:contact@agentdomain.app'));
    assert.ok(source.includes('Support'));
    assert.ok(source.indexOf('/verify') < source.indexOf('mailto:contact@agentdomain.app'));
    assert.ok(
      source.indexOf('mailto:contact@agentdomain.app') <
        source.indexOf('https://docs.agentdomain.app'),
    );
    assert.doesNotMatch(source, /<Mail\b/);
    assert.doesNotMatch(source, /import\s*\{[^}]*\bMail\b[^}]*\}\s*from 'lucide-react'/);
    assert.match(source, /<Menu\b/);
    assert.match(source, /<X\b/);
  });
}
