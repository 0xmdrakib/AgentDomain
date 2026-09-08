import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = resolve(frontendRoot, 'brand-assets.manifest.json');
const brandRoot = resolve(frontendRoot, 'public/brand/agentdomain-brand');
const supportFiles = [
  'public/7f7aee972754591b3e4695e2f955439abd945d242fe0acfe5dc705db272a674c.txt',
  'public/favicon.ico',
  'public/brand/web/logo-for-link-embed.jpg',
  'src/lib/brand-assets.json',
  'src/lib/brand-assets.ts',
];

function filesUnder(directory) {
  if (!lstatSync(directory).isDirectory()) throw new Error('Brand kit root must be a directory.');
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.isSymbolicLink()) throw new Error('Brand kit may not contain symlinks.');
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(path);
      if (!entry.isFile() || !/\.(?:png|svg)$/i.test(entry.name)) {
        throw new Error(`Unexpected brand kit entry: ${relative(frontendRoot, path)}`);
      }
      return [path];
    });
}

export function hashInput(file, content) {
  return /\.(?:png|jpe?g|ico)$/i.test(file)
    ? content
    : Buffer.from(content.toString('utf8').replaceAll('\r\n', '\n'));
}

export function verifyAssets() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !manifest.files || Array.isArray(manifest.files)) {
    throw new Error('Invalid brand asset manifest.');
  }

  const actual = [
    ...filesUnder(brandRoot).map((path) => relative(frontendRoot, path).replaceAll('\\', '/')),
    ...supportFiles,
  ].sort();
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Tracked brand asset set does not match the approved manifest.');
  }

  for (const file of expected) {
    const expectedHash = manifest.files[file];
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`Invalid asset hash: ${file}`);
    const path = resolve(frontendRoot, file);
    if (!lstatSync(path).isFile()) throw new Error(`Brand asset is not a regular file: ${file}`);
    const actualHash = createHash('sha256')
      .update(hashInput(file, readFileSync(path)))
      .digest('hex');
    if (actualHash !== expectedHash) throw new Error(`Brand asset integrity check failed: ${file}`);
  }

  const brand = JSON.parse(
    readFileSync(resolve(frontendRoot, 'src/lib/brand-assets.json'), 'utf8'),
  );
  for (const [name, path] of Object.entries(brand.assets)) {
    const file = `public${path}`;
    if (!expected.includes(file)) throw new Error(`Untracked brand mapping: ${name}`);
  }
  for (const path of Object.keys(brand.legacyAliases)) {
    try {
      lstatSync(resolve(frontendRoot, `public${path}`));
      throw new Error(`Legacy asset must remain a redirect, not a duplicate file: ${path}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return { files: expected.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Approved frontend assets verified:', verifyAssets());
}
