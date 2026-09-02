import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findForbiddenMatches } from './validate-content.mjs';

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(docsRoot, 'dist');

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function requireFile(path) {
  try {
    return await readFile(join(dist, path), 'utf8');
  } catch {
    throw new Error(`dist/${path}: required build output is missing`);
  }
}

async function validateOutput() {
  const files = await listFiles(dist);
  const relativeFiles = files.map((file) => relative(dist, file).replaceAll('\\', '/'));

  for (const required of ['index.html', '404.html', 'robots.txt', 'llms.txt', '_headers']) {
    await requireFile(required);
  }
  if (!relativeFiles.includes('sitemap-index.xml') || !relativeFiles.includes('sitemap-0.xml')) {
    throw new Error('dist: sitemap output is incomplete');
  }
  if (!relativeFiles.some((file) => /(?:^|\/)pagefind\.js$/.test(file))) {
    throw new Error('dist: Pagefind search index is missing');
  }
  if (relativeFiles.some((file) => extname(file) === '.map')) {
    throw new Error('dist: source maps must not be published');
  }

  const htmlFiles = files.filter((file) => extname(file) === '.html');
  if (htmlFiles.length < 21)
    throw new Error(`dist: expected at least 21 HTML pages, found ${htmlFiles.length}`);
  for (const file of htmlFiles) {
    const source = await readFile(file, 'utf8');
    const name = relative(dist, file).replaceAll('\\', '/');
    const forbidden = findForbiddenMatches(source);
    if (forbidden.length)
      throw new Error(`dist/${name}: forbidden content: ${forbidden.join(', ')}`);
    if (!source.includes('https://docs.agentdomain.app')) {
      throw new Error(`dist/${name}: canonical docs origin is missing`);
    }
    if (source.includes('https://agentdomain.app/brand/')) {
      throw new Error(`dist/${name}: remote frontend brand dependency is forbidden`);
    }
  }

  const robots = await requireFile('robots.txt');
  const llms = await requireFile('llms.txt');
  const headers = await requireFile('_headers');
  if (!robots.includes('https://docs.agentdomain.app/sitemap-index.xml')) {
    throw new Error('dist/robots.txt: wrong sitemap origin');
  }
  if (!llms.includes('https://docs.agentdomain.app/api-reference/overview/')) {
    throw new Error('dist/llms.txt: public documentation index is incomplete');
  }
  if (!headers.includes('https://:version.:subdomain.workers.dev/*')) {
    throw new Error('dist/_headers: workers.dev noindex policy is missing');
  }

  console.log(
    `Docs output valid: ${JSON.stringify({ files: files.length, html: htmlFiles.length, search: true })}`,
  );
}

validateOutput().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
