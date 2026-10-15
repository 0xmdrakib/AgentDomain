export function runCloudflareChecks(
  run,
  checkDocs = () => run(['--filter', '@agentdomain/docs', 'check']),
) {
  run(['--filter', '@agentdomain/frontend', 'build:cloudflare']);
  for (const environment of [['--env='], ['--env', 'preview']]) {
    run([
      '--filter',
      '@agentdomain/frontend',
      'exec',
      'wrangler',
      'deploy',
      '--dry-run',
      ...environment,
    ]);
  }
  checkDocs();
  for (const environment of [['--env='], ['--env', 'preview']]) {
    run([
      '--filter',
      '@agentdomain/docs',
      'exec',
      'wrangler',
      'deploy',
      '--dry-run',
      ...environment,
    ]);
  }
}
