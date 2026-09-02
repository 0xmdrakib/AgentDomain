import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findForbiddenMatches } from './validate-content.mjs';

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(docsRoot, 'dist');
const docsOrigin = 'https://docs.agentdomain.app';
const frontendOrigin = 'https://agentdomain.app';

export function parseAbsoluteUrl(value, context) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${context}: invalid absolute URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${context}: only credential-free HTTPS URLs are allowed`);
  }
  return url;
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1] ?? null;
}

function canonicalUrl(source, name) {
  const canonicalLinks = [...source.matchAll(/<link\b[^>]*>/gi)].filter((match) => {
    const rel = htmlAttribute(match[0], 'rel');
    return rel?.toLowerCase().split(/\s+/).includes('canonical');
  });
  if (canonicalLinks.length !== 1) {
    throw new Error(`dist/${name}: expected exactly one canonical link`);
  }
  const href = htmlAttribute(canonicalLinks[0][0], 'href');
  if (!href) throw new Error(`dist/${name}: canonical link has no href`);
  return parseAbsoluteUrl(href, `dist/${name}: canonical link`);
}

function absoluteUrls(source, context) {
  return [...source.matchAll(/\bhttps:\/\/[^\s"'<>`\\)]+/g)].map((match) =>
    parseAbsoluteUrl(match[0], context),
  );
}

export function validateHtmlUrls(source, name) {
  const canonical = canonicalUrl(source, name);
  if (canonical.origin !== docsOrigin || canonical.search || canonical.hash) {
    throw new Error(`dist/${name}: canonical docs URL is invalid`);
  }
  const hasRemoteFrontendBrandDependency = absoluteUrls(source, `dist/${name}`).some(
    (url) =>
      url.origin === frontendOrigin &&
      (url.pathname === '/brand' || url.pathname.startsWith('/brand/')),
  );
  if (hasRemoteFrontendBrandDependency) {
    throw new Error(`dist/${name}: remote frontend brand dependency is forbidden`);
  }
}

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
    validateHtmlUrls(source, name);
  }

  const robots = await requireFile('robots.txt');
  const llms = await requireFile('llms.txt');
  const headers = await requireFile('_headers');
  const sitemapLines = robots
    .split(/\r?\n/)
    .map((line) => line.match(/^Sitemap:\s*(\S+)\s*$/i)?.[1])
    .filter(Boolean);
  if (
    sitemapLines.length !== 1 ||
    parseAbsoluteUrl(sitemapLines[0], 'dist/robots.txt: sitemap').href !==
      `${docsOrigin}/sitemap-index.xml`
  ) {
    throw new Error('dist/robots.txt: wrong sitemap origin');
  }
  const llmsUrls = [...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) =>
    parseAbsoluteUrl(match[1], 'dist/llms.txt'),
  );
  if (
    !llmsUrls.some(
      (url) =>
        url.origin === docsOrigin &&
        url.pathname === '/api-reference/overview/' &&
        !url.search &&
        !url.hash,
    )
  ) {
    throw new Error('dist/llms.txt: public documentation index is incomplete');
  }
  if (!headers.includes('https://:version.:subdomain.workers.dev/*')) {
    throw new Error('dist/_headers: workers.dev noindex policy is missing');
  }

  console.log(
    `Docs output valid: ${JSON.stringify({ files: files.length, html: htmlFiles.length, search: true })}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateOutput().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
