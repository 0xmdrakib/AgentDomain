import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Static asset output may not contain symlinks.');
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function checkOpenNextBuild() {
  const output = resolve(root, '.open-next');
  const worker = resolve(output, 'worker.js');
  const assets = resolve(output, 'assets');
  if (!existsSync(worker) || !existsSync(assets)) {
    throw new Error('OpenNext worker or static assets are missing.');
  }

  const files = [worker, ...filesUnder(assets)];
  const source = readFileSync(worker, 'utf8');
  if (/\/api\/v1\/admin|Admin Console|timingSafeEqual|subtle\.sign/.test(source)) {
    throw new Error('Private transport or administration marker found in OpenNext worker.');
  }
  for (const file of files) {
    if (/(?:^|[\\/])(?:frontend\.env|\.env(?:\.|$))/.test(file)) {
      throw new Error('Environment file found in OpenNext output.');
    }
  }
  return { files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('OpenNext artifact boundary passed:', checkOpenNextBuild());
}
