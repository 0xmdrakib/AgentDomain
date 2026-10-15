import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCloudflareChecks } from './cloudflare-checks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export function publicLintArgs(manifest, langchain) {
  const duplicatesTypecheck =
    manifest.scripts?.['lint:public'] === 'turbo run lint --filter=!@agentdomain/contracts' &&
    manifest.scripts?.['typecheck:public'] ===
      'turbo run typecheck --filter=!@agentdomain/contracts' &&
    langchain.name === '@agentdomain/langchain-plugin' &&
    langchain.scripts?.lint === 'tsc --noEmit' &&
    langchain.scripts?.typecheck === 'tsc --noEmit && tsc -p tsconfig.test.json' &&
    ['prelint', 'postlint', 'pretypecheck', 'posttypecheck'].every(
      (task) => !Object.hasOwn(langchain.scripts, task),
    );
  // The unchanged typecheck runs the identical compiler command later in this invocation.
  return duplicatesTypecheck
    ? ['lint:public', '--filter=!@agentdomain/langchain-plugin']
    : ['lint:public'];
}

function runPnpm(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run public CI through pnpm.');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`pnpm ${args.join(' ')} failed`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

export function runPublicCi(run = runPnpm, { cloudflare = false } = {}) {
  for (const args of [
    ['check:public-boundary'],
    ['check:production-licenses'],
    ['audit', '--prod', '--audit-level', 'high'],
    ['format:check'],
    ['lint:public'],
    ['typecheck:public'],
    ['test:public'],
    ['build:public'],
  ]) {
    if (args[0] === 'lint:public') {
      const manifest = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      );
      const langchain = JSON.parse(
        readFileSync(new URL('../packages/langchain-plugin/package.json', import.meta.url), 'utf8'),
      );
      run(publicLintArgs(manifest, langchain));
    } else {
      run(args);
    }
  }
  if (cloudflare) {
    // Reuse only the docs lint, typecheck, tests and build completed in this invocation.
    runCloudflareChecks(run, () => run(['--filter', '@agentdomain/docs', 'validate:output']));
  }
}

export function runCi(args, run = runPnpm) {
  if (args.length === 0) return runPublicCi(run);
  if (args.length === 1 && args[0] === '--cloudflare')
    return runPublicCi(run, { cloudflare: true });
  if (args.length === 1 && args[0] === '--cloudflare-only') return runCloudflareChecks(run);
  throw new Error('Usage: pnpm ci:public [--cloudflare] or pnpm ci:cloudflare');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCi(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
