/**
 * AgentDomain Keeper Bot
 *
 * Periodically scans for agent identities approaching expiry, checks vault
 * balances, and triggers on-chain renewals via the RenewalVault contract.
 *
 * Run modes:
 *   - Continuous: `node dist/index.js` (loops every interval)
 *   - One-shot: `tsx src/cli/tick.ts` (single tick, useful for cron / Vercel Cron)
 */

import { runTick } from './tick';
import { logger } from './logger';
import { loadSharedEnv } from './load-env';

loadSharedEnv();

const TICK_INTERVAL_SECONDS = Number(process.env.KEEPER_TICK_INTERVAL_SECONDS ?? 300); // 5min

async function main() {
  logger.info('keeper-bot starting', { tickInterval: TICK_INTERVAL_SECONDS });

  // First tick immediately
  await safeTick();

  // Then loop
  setInterval(safeTick, TICK_INTERVAL_SECONDS * 1000);
}

async function safeTick() {
  try {
    await runTick();
  } catch (e) {
    logger.error('tick failed', { err: e instanceof Error ? e.message : String(e) });
  }
}

main().catch((e) => {
  logger.error('fatal', { err: String(e) });
  process.exit(1);
});
