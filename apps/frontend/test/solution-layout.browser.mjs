import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.argv[2] ?? 'playwright');
const origin = new URL(process.argv[3] ?? 'http://127.0.0.1:3109');
assert.equal(origin.hostname, '127.0.0.1', 'Browser regression tests are loopback-only');
assert.equal(origin.protocol, 'http:');
const captures = resolve(fileURLToPath(new URL('../', import.meta.url)), '.qa/solution-layout');
const paths = [
  '/ai-agent-identity',
  '/domains-for-ai-agents',
  '/onchain-agent-identity',
  '/autonomous-agent-renewals',
  '/email-for-ai-agents',
  '/dns-for-ai-agents',
  '/domain-registration-api',
  '/x402-agent-payments',
];

await mkdir(captures, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: width < 1024,
      hasTouch: width < 1024,
    });
    const page = await context.newPage();
    for (const path of paths) {
      const key = `${path.slice(1)}-${width}`;
      const response = await page.goto(new URL(path, origin).href);
      assert.equal(response.status(), 200, key);
      const heading = page.locator('h1');
      await heading.waitFor({ state: 'visible' });
      assert.doesNotMatch(await heading.innerText(), /not found/i);
      await page.screenshot({ path: resolve(captures, `${key}-heading.png`) });
      const problems = [];
      // Deferred sections must be in view when measured; root scrollWidth alone
      // misses content clipped by content-visibility containment.
      for (const section of await page.locator('main > section').all()) {
        await section.scrollIntoViewIfNeeded();
        const overflow = await section.evaluate((element) => {
          const nodes = [
            element,
            ...element.querySelectorAll('h1, h2, h3, p, article, aside, pre, a'),
          ];
          return nodes.flatMap((node) => {
            const box = node.getBoundingClientRect();
            if (!box.width || !box.height) return [];
            const outside = box.left < -1 || box.right > innerWidth + 1;
            const clipped = node.tagName !== 'PRE' && node.scrollWidth > node.clientWidth + 1;
            return outside || clipped
              ? [
                  {
                    tag: node.tagName,
                    text: node.textContent.slice(0, 70),
                    left: box.left,
                    right: box.right,
                  },
                ]
              : [];
          });
        });
        problems.push(...overflow);
      }
      const code = page.locator('pre');
      await code.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(captures, `${key}-code.png`) });
      const scroll = await code.evaluate((element) => ({
        client: element.clientWidth,
        content: element.scrollWidth,
        focusable: element.tabIndex === 0,
        overflow: getComputedStyle(element).overflowX,
      }));
      if (!scroll.focusable || scroll.overflow !== 'auto') problems.push({ codeScrolling: scroll });
      if (scroll.content > scroll.client && scroll.focusable) {
        await code.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('pre').scrollLeft > 0);
      }
      results.push({ path, width, problems, scroll });
      console.log(
        `${problems.length ? 'FAIL' : 'PASS'} ${key}: ${problems.length} layout problems`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(resolve(captures, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
}
assert.equal(results.length, 32);
assert.deepEqual(
  results
    .filter((result) => result.problems.length)
    .map(({ path, width, problems }) => ({ path, width, problems: problems.length })),
  [],
  `Layout failures; inspect ${resolve(captures, 'results.json')} and the captured screenshots`,
);
