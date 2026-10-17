import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import {
  assertReleaseContext,
  releaseContext,
  RELEASE_POLICY,
} from './public-release-identity.mjs';

export const RELEASE_CI_LIMITS = Object.freeze({ maxBytes: 1_048_576, timeoutMs: 10_000 });

export function verifyReleaseCi(payload, context) {
  assertReleaseContext(context);
  if (
    payload?.source_commit?.sha !== context.sha ||
    payload.source_commit.commit?.verification?.verified !== true ||
    payload.triggering_operator?.login !== RELEASE_POLICY.operator.login ||
    String(payload.triggering_operator?.id) !== RELEASE_POLICY.operator.id
  )
    throw new Error('RELEASE_SOURCE_UNQUALIFIED');
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
      [candidate.repository, candidate.head_repository].every(
        (repo) =>
          repo?.full_name === context.repository &&
          String(repo.id) === RELEASE_POLICY.repositoryId &&
          repo.owner?.login === context.owner &&
          String(repo.owner?.id) === context.ownerId,
      ),
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
    const context = releaseContext(process.env);
    const id = verifyReleaseCi(payload, context);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `publication-authorized=${context.owner === RELEASE_POLICY.activeOwner}\n`,
      );
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
