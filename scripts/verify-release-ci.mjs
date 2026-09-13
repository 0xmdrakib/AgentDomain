import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repository = '0xmdrakib/AgentDomain';
export const RELEASE_CI_LIMITS = Object.freeze({ maxBytes: 1_048_576, timeoutMs: 10_000 });

export function verifyReleaseCi(payload, context) {
  if (
    context.repository !== repository ||
    context.ref !== 'refs/heads/main' ||
    !/^[0-9a-f]{40}$/.test(context.sha ?? '')
  )
    throw new Error('RELEASE_CONTEXT_INVALID');
  if (!Array.isArray(payload?.workflow_runs) || payload.workflow_runs.length > 10)
    throw new Error('RELEASE_CI_RESPONSE_INVALID');
  const run = payload.workflow_runs.find(
    (candidate) =>
      Number.isSafeInteger(candidate?.id) &&
      candidate.id > 0 &&
      candidate.head_sha === context.sha &&
      candidate.head_branch === 'main' &&
      candidate.event === 'push' &&
      candidate.status === 'completed' &&
      candidate.conclusion === 'success' &&
      candidate.path === '.github/workflows/public-ci.yml' &&
      candidate.repository?.full_name === repository &&
      candidate.head_repository?.full_name === repository,
  );
  if (!run) throw new Error('RELEASE_CI_SUCCESS_REQUIRED');
  return run.id;
}

async function main() {
  const chunks = [];
  let bytes = 0;
  const deadline = setTimeout(() => {
    process.stdin.destroy(new Error('RELEASE_CI_INPUT_TIMEOUT'));
  }, RELEASE_CI_LIMITS.timeoutMs);
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > RELEASE_CI_LIMITS.maxBytes) throw new Error('RELEASE_CI_INPUT_TOO_LARGE');
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const id = verifyReleaseCi(payload, {
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
    });
    console.log(`Public CI passed for this exact main commit (run ${id}).`);
  } finally {
    clearTimeout(deadline);
    process.stdin.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Release requires a successful Public CI push run for this exact main commit.');
    process.exitCode = 1;
  });
}
