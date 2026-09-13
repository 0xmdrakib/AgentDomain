import assert from 'node:assert/strict';

// Synthetic test-process preload. Never loaded by the runnable Python examples.
// The actual AgentDomain Node MCP/SDK code still handles every tool invocation.
for (const key of Object.keys(process.env)) {
  assert.doesNotMatch(
    key,
    /^(?:AGENT_PRIVATE_KEY|AGENTDOMAIN_.*|RENEWAL_VAULT_ADDRESS|OPENAI_API_KEY|ANTHROPIC_API_KEY|AUTOGEN_MODEL_CONFIG|NODE_OPTIONS|NPM_TOKEN|AWS_.*|GOOGLE_.*|HTTPS?_PROXY)$/i,
    `Unexpected sensitive child environment name: ${key}`,
  );
}
const originalError = console.error;
console.error = (...parts) => {
  // Avoid publishing dozens of synthetic ABI traces in the Python test log.
  if (typeof parts[0] !== 'string' || !/^RENEWAL_.*FIXTURE /.test(parts[0]))
    originalError(...parts);
};
if (process.env.AUTOGEN_FIXTURE_MODE)
  process.env.RENEWAL_RPC_FIXTURE_MODE = process.env.AUTOGEN_FIXTURE_MODE;
await import('./fixtures/renewal-rpc.mjs');
console.error(`AUTOGEN_CHILD_PID ${process.pid}`);
console.error('AUTOGEN_TEST_OBSERVATIONS synthetic RPC fixture; no live identity or renewal proof');
