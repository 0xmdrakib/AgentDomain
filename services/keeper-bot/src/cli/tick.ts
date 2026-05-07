/**
 * Single-tick CLI entrypoint. Useful for cron / Vercel Cron / GitHub Actions.
 */
import { runTick } from '../tick';

runTick()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
