import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData, parseAbi } from 'viem';
import { encodeSetAutoRenewCalldata } from '@agentdomain/sdk';

// Explicit native-Python suite. No silent skip or installation during npm tests.
const root = fileURLToPath(new URL('..', import.meta.url));
const localPython = fileURLToPath(
  new URL(
    process.platform === 'win32'
      ? '../examples/crewai/.venv-native/Scripts/python.exe'
      : '../examples/crewai/.venv-native/bin/python',
    import.meta.url,
  ),
);
const python = process.env.AGENTDOMAIN_CREWAI_PYTHON ?? localPython;
assert.ok(
  existsSync(python),
  'Install examples/crewai/requirements.lock and the built agentdomain-crewai wheel in a fresh .venv-native, or set AGENTDOMAIN_CREWAI_PYTHON to that environment.',
);
const env = {
  CREWAI_TEST_NODE: process.execPath,
  OTEL_SDK_DISABLED: 'true',
  CREWAI_TELEMETRY_DISABLED: 'true',
  CREWAI_TRACING_ENABLED: 'false',
  PYTHONUTF8: '1',
  PYTHONDONTWRITEBYTECODE: '1',
};
for (const [name, value] of Object.entries(process.env)) {
  if (
    /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|COMSPEC|TEMP|TMP|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|APPDATA|LOCALAPPDATA|USER|USERNAME|LANG)$/i.test(
      name,
    )
  )
    env[name] = value;
}
const child = spawn(python, ['test/crewai-integration.py'], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '',
  stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
const traces = (prefix, stream = stderr) =>
  stream
    .split(/\r?\n/)
    .filter((line) => line.includes(prefix))
    .map((line) => JSON.parse(line.slice(line.indexOf(prefix) + prefix.length)));
const children = traces('CREWAI_CHILD ');
process.stdout.write(
  stdout
    .split(/\r?\n/)
    .filter((line) => !/^CREWAI_(PLAN|CHROMA) /.test(line))
    .join('\n'),
);
process.stdout.write(
  stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/(?:CREWAI_[A-Z_]+|IDENTITY_[A-Z_]+) .*/, ''))
    .filter((line) => line && !/^Processing request of type/.test(line))
    .join('\n'),
);
for (const { pid } of children) {
  assert.throws(
    () => process.kill(pid, 0),
    { code: 'ESRCH' },
    `MCP child ${pid} survived its context manager.`,
  );
}
assert.equal(code, 0, 'Native CrewAI integration failed; diagnostics above.');
assert.ok(children.length >= 7, 'The real Node MCP processes must have run.');
const calls = traces('CREWAI_RPC ');
const failedCallCounts = new Map();
for (const call of calls.filter((call) => call.mode === 'rpc-error')) {
  failedCallCounts.set(call.pid, (failedCallCounts.get(call.pid) ?? 0) + 1);
}
assert.ok(failedCallCounts.size >= 2);
for (const count of failedCallCounts.values())
  assert.equal(count, 1, 'Failed RPC must not be retried.');
assert.ok(calls.some((call) => call.method === 'eth_call'));
assert.ok(traces('CREWAI_VAULT ').some((call) => call.functionName === 'balanceOfToken'));
const chromaProofs = traces('CREWAI_CHROMA ', stdout);
assert.ok(chromaProofs.length >= 10);
for (const proof of chromaProofs) {
  assert.ok(proof.watched >= 30);
  assert.equal(proof.hits, 0);
}
const plans = traces('CREWAI_PLAN ', stdout);
assert.equal(plans.length, 1);
const plan = plans[0];
assert.equal(plan.transaction.to.toLowerCase(), '0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a');
assert.equal(plan.transaction.data, encodeSetAutoRenewCalldata(7n, true, 'crewai_example'));
assert.equal(plan.transaction.value, '0');
const decoded = decodeFunctionData({
  abi: parseAbi(['function setAutoRenew(uint256 tokenId,bool enabled)']),
  data: plan.transaction.data,
});
assert.equal(decoded.functionName, 'setAutoRenew');
assert.deepEqual(decoded.args, [7n, true]);
for (const call of calls)
  assert.ok(
    ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(call.method),
  );
console.log(
  `\nOfficial CrewAI connector: ${children.length} real Node processes, ${calls.length} read-only RPC calls, all children exited; ${chromaProofs.length} Chroma tripwire checks passed.`,
);
