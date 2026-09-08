import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { frontendRoot } from '../scripts/verify-assets.mjs';

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const read = (file) => readFileSync(resolve(frontendRoot, file));
const brand = JSON.parse(read('src/lib/brand-assets.json'));

test('ICO contains the exact original 16/32/48/96px PNG frames', () => {
  const ico = read(`public${brand.assets.faviconIco}`);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 4);
  let offset = 70;
  for (const [index, size] of [16, 32, 48, 96].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt32LE(entry + 12), offset);
    const original = read(
      `public/brand/agentdomain-brand/platform-size-based/agentdomain-logo-${String(size).padStart(4, '0')}.png`,
    );
    assert.equal(ico.readUInt32LE(entry + 8), original.length);
    assert.deepEqual(ico.subarray(offset, offset + original.length), original);
    offset += original.length;
  }
  assert.equal(offset, ico.length);
  assert.equal(brand.legacyAliases['/favicon.ico'], undefined);
  assert.equal(brand.legacyAliases['/brand/favicon.ico'], 'faviconIco');
  assert.match(
    read('public/_headers').toString(),
    /\/favicon\.ico\r?\n\s+Content-Type: image\/x-icon/,
  );
});

test('social delivery copy preserves dimensions and visual fidelity within 600KB', async () => {
  const original = read(`public${brand.assets.socialCardOriginal}`);
  const delivery = read(`public${brand.assets.socialCard}`);
  assert.ok(delivery.length < 600_000);
  assert.equal(delivery.subarray(0, 3).toString('hex'), 'ffd8ff');
  assert.equal(brand.socialImage.type, 'image/jpeg');
  const source = await sharp(original).raw().toBuffer({ resolveWithObject: true });
  const target = await sharp(delivery).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(target.info, source.info);
  assert.equal(target.info.width, brand.socialImage.width);
  assert.equal(target.info.height, brand.socialImage.height);
  let error = 0;
  for (let index = 0; index < source.data.length; index++)
    error += Math.abs(source.data[index] - target.data[index]);
  assert.ok(error / source.data.length < 1, 'Mean decoded channel error must stay below 1/255');
});
