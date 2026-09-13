import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const fixtureObservation =
  'AUTOGEN_TEST_OBSERVATIONS synthetic RPC fixture; no live identity or renewal proof';
const ownedTestLine = /^(test_[a-z0-9_]+) \(__main__\.RealWorkbenchTests\.\1\) \.\.\. ?(.*)$/;

function fixtureChildPids(stderr, forbiddenPids = []) {
  const lines = stderr.split(/\r?\n/);
  const children = new Set();
  const forbidden = new Set([1, ...forbiddenPids]);
  let ownedTest = false;
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const prefix = ownedTestLine.exec(line);
    if (prefix) {
      ownedTest = true;
      line = prefix[2];
    } else if (/^test_.* \(.*\) \.\.\./.test(line)) {
      ownedTest = false;
    }
    if (!ownedTest) continue;
    if (/^(?:ok|FAIL|ERROR|skipped\b)/.test(line)) {
      ownedTest = false;
      continue;
    }
    if (!line.startsWith('AUTOGEN_CHILD_PID ')) continue;

    // Only the fixture's exact two-line report inside our test context is trusted.
    assert.equal(lines[index + 1], fixtureObservation, 'Unpaired MCP fixture PID report.');
    const match = /^AUTOGEN_CHILD_PID ([1-9][0-9]{0,9})$/.exec(line);
    assert.ok(match, 'MCP fixture PID must be a canonical positive integer.');
    const pid = Number(match[1]);
    assert.ok(pid <= 0x7fffffff, 'MCP fixture PID must fit the process API integer range.');
    assert.ok(!forbidden.has(pid), 'MCP fixture PID must not target the host or Python parent.');
    assert.ok(!children.has(pid), 'MCP fixture PID reports must identify distinct children.');
    children.add(pid);
    index += 1;
  }
  return [...children];
}

function fixtureReport(pid, prefix = '') {
  return `${prefix}AUTOGEN_CHILD_PID ${pid}\n${fixtureObservation}\n`;
}

const fixtureTestPrefix =
  'test_missing_identity_and_rpc_failure_are_not_fabricated_success ' +
  '(__main__.RealWorkbenchTests.test_missing_identity_and_rpc_failure_are_not_fabricated_success) ... ';

test('fixture PID parsing includes unittest-prefixed and standalone child reports', () => {
  const log =
    fixtureReport(4204, fixtureTestPrefix) +
    'AgentDomain MCP server running on stdio\n' +
    fixtureReport(4208) +
    'ok\n';
  assert.deepEqual(fixtureChildPids(log), [4204, 4208]);
  assert.deepEqual(fixtureChildPids(log.replaceAll('\n', '\r\n')), [4204, 4208]);
});

test('fixture PID parsing excludes unrelated output, foreign tests and finished contexts', () => {
  const log =
    fixtureReport(4300) +
    fixtureReport(4304, 'test_foreign (third_party.OtherTests.test_foreign) ... ') +
    fixtureReport(4204, fixtureTestPrefix) +
    'untrusted text AUTOGEN_CHILD_PID 4308\n' +
    '{"output":"AUTOGEN_CHILD_PID 4312"}\n' +
    'ok\n' +
    fixtureReport(4316);
  assert.deepEqual(fixtureChildPids(log), [4204]);
});

test('fixture PID parsing rejects malformed, nonpositive and out-of-range IDs', () => {
  for (const pid of ['0', '-1', '+42', '042', '1.5', 'NaN', '7e3', '2147483648', '9'.repeat(50)]) {
    assert.throws(() => fixtureChildPids(fixtureReport(pid, fixtureTestPrefix)));
  }
});

test('fixture PID parsing rejects host, Python parent and duplicate child IDs', () => {
  for (const pid of [1, 4400, 4404, 4408]) {
    assert.throws(() =>
      fixtureChildPids(fixtureReport(pid, fixtureTestPrefix), [4400, 4404, 4408]),
    );
  }
  assert.throws(() =>
    fixtureChildPids(fixtureReport(4204, fixtureTestPrefix) + fixtureReport(4204)),
  );
});

test('fixture PID parsing rejects a report without the exact fixture observation marker', () => {
  assert.throws(() => fixtureChildPids(`${fixtureTestPrefix}AUTOGEN_CHILD_PID 4204\n`));
  assert.throws(() =>
    fixtureChildPids(`${fixtureTestPrefix}AUTOGEN_CHILD_PID 4204\nuser-provided observation\n`),
  );
});

const python = process.env.AGENTDOMAIN_AUTOGEN_PYTHON;
test(
  'native Python AutoGen + real MCP stdio, synthetic RPC only',
  {
    skip: python
      ? false
      : 'Optional Python integration: set AGENTDOMAIN_AUTOGEN_PYTHON to the isolated pinned venv executable.',
    timeout: 120_000,
  },
  (t) => {
    const result = spawnSync(
      python,
      [
        '-B',
        fileURLToPath(new URL('../examples/autogen/tests/test_workbench.py', import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          AGENTDOMAIN_AUTOGEN_NODE: process.execPath,
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 115_000,
        maxBuffer: 1_048_576,
      },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(
      result.status,
      0,
      `Python AutoGen integration failed. Observations are synthetic.\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /SYNTHETIC RPC/);
    assert.match(result.stderr, /\bOK\b/);
    const count = Number(result.stderr.match(/Ran (\d+) tests? in /)?.[1]);
    assert.ok(count >= 10, 'The actual Python integration suite must run, not just import.');
    t.diagnostic(
      `${count} Python checks passed using actual AutoGen, actual Node MCP/SDK and synthetic RPC observations.`,
    );
    const children = fixtureChildPids(result.stderr, [process.pid, process.ppid, result.pid]);
    assert.ok(children.length > 0, 'The suite must actually launch the Node MCP child.');
    for (const pid of children) {
      assert.throws(
        () => process.kill(pid, 0),
        (error) => error.code === 'ESRCH',
        `MCP child ${pid} must be stopped after the Python context exits.`,
      );
    }
    t.diagnostic(
      `All ${children.length} fixture-owned MCP children exited: ${children.join(', ')}.`,
    );
  },
);
