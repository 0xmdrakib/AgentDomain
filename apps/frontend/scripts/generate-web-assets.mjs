import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendRoot, hashInput, verifyAssets } from './verify-assets.mjs';

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const sha256 = (file, content) =>
  createHash('sha256').update(hashInput(file, content)).digest('hex');
const outputs = ['public/favicon.ico', 'public/brand/web/logo-for-link-embed.jpg'];
const mutable = new Set([...outputs, 'src/lib/brand-assets.json', 'src/lib/brand-assets.ts']);

export async function generateWebAssets() {
  const manifestPath = resolve(frontendRoot, 'brand-assets.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (mutable.has(file)) continue;
    assert.equal(
      sha256(file, readFileSync(resolve(frontendRoot, file))),
      hash,
      `Original changed: ${file}`,
    );
  }

  const original = resolve(frontendRoot, 'public/brand/agentdomain-brand/logo-for-link-embed.png');
  const metadata = await sharp(original).metadata();
  assert.equal(metadata.hasAlpha, false, 'Do not silently discard transparency');
  const social = await sharp(original)
    .jpeg({ quality: 98, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
  assert.ok(social.length < 600_000, 'Social delivery image exceeds compatibility budget');
  const encoded = await sharp(social).metadata();
  assert.equal(encoded.width, metadata.width);
  assert.equal(encoded.height, metadata.height);

  // An ICO directory wraps the existing PNG variants byte-for-byte; no artwork is resized.
  const images = [16, 32, 48, 96].map((size) => {
    const file = `public/brand/agentdomain-brand/platform-size-based/agentdomain-logo-${String(size).padStart(4, '0')}.png`;
    const bytes = readFileSync(resolve(frontendRoot, file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.equal(bytes[24], 8);
    assert.ok([2, 6].includes(bytes[25]));
    return { size, bytes, depth: bytes[25] === 6 ? 32 : 24 };
  });
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, bytes, depth }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(depth, entry + 6);
    directory.writeUInt32LE(bytes.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  const icon = Buffer.concat([directory, ...images.map(({ bytes }) => bytes)]);
  for (const [index, bytes] of [icon, social].entries()) {
    const file = resolve(frontendRoot, outputs[index]);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  for (const file of mutable)
    manifest.files[file] = sha256(file, readFileSync(resolve(frontendRoot, file)));
  manifest.files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  verifyAssets();
  return {
    socialBytes: social.length,
    iconBytes: icon.length,
    width: encoded.width,
    height: encoded.height,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(await generateWebAssets());
