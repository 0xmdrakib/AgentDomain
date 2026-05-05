/**
 * Production preflight runner.
 *
 * Run with:
 *   pnpm --filter @agentdomain/web preflight
 *   pnpm --filter @agentdomain/web preflight -- --external
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProductionPreflight } from '../src/lib/preflight';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');

loadEnv({ path: resolve(webRoot, '.env.local'), override: true });

async function main() {
  const external = process.argv.includes('--external');
  const report = await runProductionPreflight({ external });

  console.log(`Status: ${report.status}`);
  console.log(`Generated: ${report.generatedAt}`);
  for (const [name, check] of Object.entries(report.checks)) {
    const latency = check.latencyMs == null ? '' : ` (${check.latencyMs}ms)`;
    console.log(`${check.status.toUpperCase()} ${name}${latency}: ${check.message}`);
    if (check.details) {
      console.log(JSON.stringify(check.details, null, 2));
    }
  }

  if (report.status === 'blocked') process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
