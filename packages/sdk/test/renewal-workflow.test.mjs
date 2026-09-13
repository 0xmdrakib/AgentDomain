import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  keccak256,
  multicall3Abi,
  parseAbi,
  numberToHex,
  stringToHex,
} from 'viem';
import { AGENT_IDENTITY_REGISTRY_BASE, encodeSetAutoRenewCalldata } from '../dist/index.js';
import { IDENTITY_INSPECTION_ABI } from '../dist/identity-inspection.js';
import {
  AGENT_RENEWAL_VAULT_BASE,
  AGENT_RENEWAL_USDC_BASE,
  RENEWAL_WORKFLOW_ABI,
  RenewalWorkflowError,
  inspectAgentRenewal,
  prepareAutoRenewChange,
  executeAutoRenewChange,
  confirmAutoRenewChange,
} from '../dist/renewal-workflow.js';

const owner = getAddress('0x' + '11'.repeat(20)),
  other = getAddress('0x' + '22'.repeat(20));
const registry = getAddress(AGENT_IDENTITY_REGISTRY_BASE);
const vault = AGENT_RENEWAL_VAULT_BASE,
  usdc = AGENT_RENEWAL_USDC_BASE;
const aggregate = '0xca11bde05977b3631167028862be2a173976ca11';
const token = '9007199254740993',
  txHash = '0x' + 'ef'.repeat(32);
const abi = [...IDENTITY_INSPECTION_ABI, ...RENEWAL_WORKFLOW_ABI];
const writeAbi = parseAbi(['function setAutoRenew(uint256 tokenId,bool enabled)']);
const intent = {
  tokenId: token,
  expectedOwner: owner,
  enabled: true,
  builderCode: 'fixture_builder',
};
const errorCode = (code) => (error) => error instanceof RenewalWorkflowError && error.code === code;
function rehashPlan(plan) {
  const canonical = (value) =>
    Array.isArray(value)
      ? '[' + value.map(canonical).join(',') + ']'
      : value && typeof value === 'object'
        ? '{' +
          Object.keys(value)
            .sort()
            .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
            .join(',') +
          '}'
        : JSON.stringify(value);
  const { id, ...body } = plan;
  plan.id = keccak256(stringToHex(canonical(body)));
  return plan;
}

/** Real viem HTTP/ABI decoding, all fetches intercepted. No wallet or network writes. */
function fixture(t, patch = {}) {
  const blocks = new Map(),
    hashBlocks = new Map(),
    calls = [],
    sends = [];
  let current,
    safe,
    lastTransaction,
    receipt = null;
  let foreign = null,
    numericHeaders = 0,
    safeHeaders = 0;
  const controls = {
    chainId: 8453,
    walletChainId: 8453,
    addresses: [owner],
    unavailable: false,
    submissionError: null,
    returnedHash: txHash,
    receiptError: false,
    txPatch: {},
    receiptPatch: {},
    wrongReceiptCanonical: false,
    omitToggle: false,
    firstSafeForeign: false,
  };
  const create = (state) => {
    const number = current ? current.number + 1n : 50_000_000n;
    const block = {
      number,
      hash: '0x' + number.toString(16).padStart(64, '0'),
      timestamp: state.now,
      state: structuredClone(state),
    };
    blocks.set(number.toString(), block);
    hashBlocks.set(block.hash, block);
    current = block;
    safe = block;
    return block;
  };
  create({
    owner,
    recordedOwner: owner,
    domain: 'renew.example',
    revoked: false,
    createdAt: 500n,
    expiresAt: 2000n,
    metadataUri: 'ipfs://not-fetched',
    now: 1000n,
    enabled: false,
    balance: 5_000_001n,
    minimum: 3_900_000n,
    pending: [0n, 0n, 0n],
    window: 1200n,
    duration: 3600n,
    last: 0n,
    nft: registry,
    registry,
    usdc,
    linkedVault: vault,
    missing: false,
    ...patch,
  });
  function advance(patch) {
    return create({ ...current.state, now: current.timestamp + 1n, ...patch });
  }
  function execute(target, data, block) {
    const s = block.state,
      call = decodeFunctionData({ abi, data });
    const registryRead = target.toLowerCase() === registry.toLowerCase();
    assert.ok(registryRead || target.toLowerCase() === vault.toLowerCase());
    const name = call.functionName;
    const identityNames = [
      'getTokenIdByDomain',
      'getIdentity',
      'ownerOf',
      'tokenURI',
      'isActive',
      'renewalVault',
    ];
    assert.equal(
      identityNames.includes(name),
      registryRead,
      'reads go to their canonical contract',
    );
    if (call.args?.length && name !== 'getTokenIdByDomain')
      assert.equal(call.args[0].toString(), token);
    if (name === 'getIdentity' && s.missing)
      return {
        success: false,
        returnData: encodeErrorResult({
          abi: IDENTITY_INSPECTION_ABI,
          errorName: 'TokenDoesNotExist',
          args: [BigInt(token)],
        }),
      };
    const renewable =
      s.enabled &&
      s.pending[0] === 0n &&
      !s.revoked &&
      s.expiresAt <= block.timestamp + s.window &&
      block.timestamp <= s.expiresAt + s.window;
    const values = {
      getTokenIdByDomain: s.missing || call.args?.[0] !== s.domain ? 0n : BigInt(token),
      getIdentity: {
        owner: s.recordedOwner,
        domain: s.domain,
        basename: 'renew.base.eth',
        ensName: '',
        metadataUri: s.metadataUri,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revoked: s.revoked,
      },
      ownerOf: s.owner,
      tokenURI: s.tokenUri ?? s.metadataUri,
      isActive: !s.revoked && s.expiresAt > block.timestamp,
      balanceOfToken: s.balance,
      autoRenewEnabled: s.enabled,
      pendingRenewals: s.pending,
      renewalWindow: s.window,
      renewalDuration: s.duration,
      renewalFee: s.minimum,
      nft: s.nft,
      registry: s.registry,
      usdc: s.usdc,
      renewalVault: s.linkedVault,
      lastRenewedAt: s.last,
      isRenewable: s.renewableOverride ?? renewable,
    };
    assert.ok(Object.hasOwn(values, name), name);
    return {
      success: true,
      returnData: encodeFunctionResult({ abi, functionName: name, result: values[name] }),
    };
  }
  const rawBlock = (block) => ({
    number: numberToHex(block.number),
    hash: block.hash,
    timestamp: numberToHex(block.timestamp),
    transactions: [],
  });
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, 'https://mainnet.base.org/');
    assert.equal(request.method, 'POST');
    for (const key of request.headers.keys())
      assert.doesNotMatch(key, /authorization|cookie|api.key|payment/);
    const rpc = await request.json();
    calls.push(rpc);
    if (
      controls.unavailable ||
      (rpc.method === 'eth_getTransactionReceipt' && controls.receiptError)
    )
      return Response.json({
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -32000, message: 'RPC https://secret.invalid/key unavailable' },
      });
    let result;
    if (rpc.method === 'eth_chainId') result = numberToHex(controls.chainId);
    else if (rpc.method === 'eth_getBlockByNumber') {
      const block =
        rpc.params[0] === 'safe'
          ? foreign && (++safeHeaders > 1 || controls.firstSafeForeign)
            ? foreign
            : safe
          : foreign && [2, 3].includes(++numericHeaders)
            ? foreign
            : blocks.get(BigInt(rpc.params[0]).toString());
      assert.ok(block);
      result = rawBlock(block);
      if (
        controls.wrongReceiptCanonical &&
        receipt &&
        rpc.params[0] !== 'safe' &&
        result.hash === receipt.blockHash
      )
        result.hash = '0x' + 'cc'.repeat(32);
    } else if (rpc.method === 'eth_call') {
      const selector = rpc.params[1];
      assert.equal(selector.requireCanonical, true);
      assert.deepEqual(Object.keys(selector).sort(), ['blockHash', 'requireCanonical']);
      const block = hashBlocks.get(selector.blockHash);
      assert.ok(block, 'exact stored block hash only');
      const target = rpc.params[0].to;
      assert.equal(rpc.params[0].from, undefined);
      assert.equal(rpc.params[0].value, undefined);
      if (target.toLowerCase() === aggregate) {
        const batch = decodeFunctionData({ abi: multicall3Abi, data: rpc.params[0].data });
        assert.equal(batch.functionName, 'aggregate3');
        assert.ok([4, 12].includes(batch.args[0].length));
        result = encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: batch.args[0].map((call) => execute(call.target, call.callData, block)),
        });
      } else {
        const read = execute(target, rpc.params[0].data, block);
        if (!read.success)
          return Response.json({
            jsonrpc: '2.0',
            id: rpc.id,
            error: { code: 3, message: 'execution reverted', data: read.returnData },
          });
        result = read.returnData;
      }
    } else if (rpc.method === 'eth_getTransactionReceipt')
      result = receipt ? { ...receipt, ...controls.receiptPatch } : null;
    else if (rpc.method === 'eth_getTransactionByHash')
      result = lastTransaction ? { ...lastTransaction, ...controls.txPatch } : null;
    else assert.fail('No other RPC is permitted: ' + rpc.method);
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  });
  const wallet = {
    getChainId: async () => controls.walletChainId,
    getAddresses: async () => controls.addresses,
    sendTransaction: async (tx) => {
      sends.push(tx);
      if (controls.submissionError) throw controls.submissionError;
      return controls.returnedHash;
    },
  };
  function mine({ reverted = false, unsafe = false } = {}) {
    assert.equal(sends.length, 1);
    const tx = sends[0],
      decoded = decodeFunctionData({ abi: writeAbi, data: tx.data });
    const previousSafe = safe;
    const block = advance(reverted ? {} : { enabled: decoded.args[1] });
    if (unsafe) safe = previousSafe;
    lastTransaction = {
      hash: txHash,
      from: typeof tx.account === 'string' ? tx.account : tx.account.address,
      to: tx.to,
      value: '0x0',
      input: tx.data,
      chainId: '0x2105',
      blockHash: block.hash,
      blockNumber: numberToHex(block.number),
      nonce: '0x0',
      transactionIndex: '0x0',
      gas: '0x10000',
      type: '0x2',
      maxFeePerGas: '0x10',
      maxPriorityFeePerGas: '0x1',
      v: '0x0',
      r: '0x1',
      s: '0x1',
      accessList: [],
    };
    const log = {
      address: vault,
      blockHash: block.hash,
      blockNumber: numberToHex(block.number),
      transactionHash: txHash,
      transactionIndex: '0x0',
      logIndex: '0x0',
      removed: false,
      topics: encodeEventTopics({
        abi: RENEWAL_WORKFLOW_ABI,
        eventName: 'AutoRenewToggled',
        args: { tokenId: BigInt(token) },
      }),
      data: encodeAbiParameters([{ type: 'bool' }], [decoded.args[1]]),
    };
    receipt = {
      transactionHash: txHash,
      transactionIndex: '0x0',
      blockHash: block.hash,
      blockNumber: numberToHex(block.number),
      from: typeof tx.account === 'string' ? tx.account : tx.account.address,
      to: tx.to,
      contractAddress: null,
      cumulativeGasUsed: '0x100',
      gasUsed: '0x100',
      effectiveGasPrice: '0x1',
      type: '0x2',
      status: reverted ? '0x0' : '0x1',
      logs: reverted || controls.omitToggle ? [] : [log],
      logsBloom: '0x' + '00'.repeat(256),
    };
  }
  return {
    controls,
    calls,
    sends,
    wallet,
    advance,
    mine,
    makeSafe() {
      safe = current;
    },
    forkReadbackAtSameHeight() {
      foreign = { ...current, hash: '0x' + 'dd'.repeat(32), state: structuredClone(current.state) };
      hashBlocks.set(foreign.hash, foreign);
      numericHeaders = 0;
      safeHeaders = 0;
    },
    state: () => current.state,
    block: () => current,
    receipt: () => receipt,
  };
}

describe('canonical renewal inspection and unsigned preparation', { concurrency: false }, () => {
  for (const input of [{ domain: 'renew.example' }, { tokenId: token }])
    it(`reads ${Object.keys(input)[0]} vault and identity at the exact same canonical hash`, async (t) => {
      const f = fixture(t);
      const result = await inspectAgentRenewal(input);
      assert.equal(result.status, 'found');
      assert.equal(result.consistent, true);
      assert.equal(result.identity.tokenId, token);
      assert.equal(result.vault.availableAtomicUsdc, '5000001');
      assert.equal(result.vault.minimumFeeAtomicUsdc, '3900000');
      assert.equal(result.vault.reservedAtomicUsdc, '0');
      assert.equal(result.renewalExecution, 'keeper_registrar_confirmation_required');
      assert.equal(f.calls.length, 'domain' in input ? 10 : 9);
      assert.ok(
        f.calls
          .filter((c) => c.method === 'eth_call')
          .every(
            (c) =>
              c.params[1].blockHash === result.identity.block.hash &&
              c.params[1].requireCanonical === true,
          ),
      );
      assert.doesNotThrow(() => JSON.stringify(result));
      assert.equal(f.sends.length, 0);
    });
  it('does not confuse the native renewable predicate or minimum with quote funding', async (t) => {
    fixture(t, { enabled: true, balance: 0n });
    const result = await inspectAgentRenewal({ tokenId: token });
    assert.equal(result.vault.isRenewable, true);
    assert.equal(result.checks.availableCoversMinimum, false);
    assert.equal(result.consistent, true);
    assert.equal(result.quote, undefined);
    assert.equal(result.renewalCompleted, undefined);
  });
  it('zero minimum is unset, not a free registrar quote', async (t) => {
    fixture(t, { minimum: 0n });
    const result = await inspectAgentRenewal({ tokenId: token });
    assert.equal(result.consistent, true);
    assert.equal(result.checks.minimumFeeConfigured, false);
    assert.equal(result.checks.availableCoversMinimum, false);
  });
  it('pending funds are separately reserved and disable does not cancel them', async (t) => {
    fixture(t, { enabled: true, balance: 1n, pending: [3900000n, 2000n, 900n] });
    const plan = await prepareAutoRenewChange({ ...intent, enabled: false });
    assert.equal(plan.observation.vault.availableAtomicUsdc, '1');
    assert.equal(plan.observation.vault.reservedAtomicUsdc, '3900000');
    assert.equal(plan.observation.vault.isRenewable, false);
    assert.match(plan.warnings.join(' '), /does not cancel/);
    assert.match(plan.warnings.join(' '), /does not itself renew/);
  });
  for (const patch of [
    { nft: other },
    { registry: other },
    { usdc: other },
    { linkedVault: other },
    { recordedOwner: other },
    { tokenUri: 'ipfs://wrong' },
    { window: 4000n },
    { pending: [1n, 1999n, 900n] },
    { pending: [0n, 2000n, 900n] },
    { last: 1001n },
    { renewableOverride: true },
  ])
    it(`rejects inconsistent state ${Object.keys(patch)[0]}`, async (t) => {
      fixture(t, patch);
      const observation = await inspectAgentRenewal({ tokenId: token });
      assert.equal(observation.consistent, false);
      await assert.rejects(prepareAutoRenewChange(intent), errorCode('INCONSISTENT_STATE'));
    });
  it('missing identity has no invented vault balances', async (t) => {
    const f = fixture(t, { missing: true });
    const result = await inspectAgentRenewal({ domain: 'renew.example' });
    assert.equal(result.status, 'not_found');
    assert.equal(result.vault, undefined);
    assert.equal(f.calls.length, 5);
    await assert.rejects(prepareAutoRenewChange(intent), errorCode('IDENTITY_NOT_FOUND'));
  });
  it('expected-owner mismatch and wrong chain never prepare a transaction', async (t) => {
    const f = fixture(t);
    await assert.rejects(
      prepareAutoRenewChange({ ...intent, expectedOwner: other }),
      errorCode('OWNER_MISMATCH'),
    );
    f.controls.chainId = 1;
    await assert.rejects(prepareAutoRenewChange(intent), errorCode('WRONG_CHAIN'));
  });
  it('revoked and past-grace identities can disable but cannot enable', async (t) => {
    const f = fixture(t, { revoked: true, enabled: true });
    await assert.rejects(prepareAutoRenewChange(intent), errorCode('REVOKED'));
    assert.equal((await prepareAutoRenewChange({ ...intent, enabled: false })).enabled, false);
    f.advance({ revoked: false, now: 4000n });
    await assert.rejects(prepareAutoRenewChange(intent), errorCode('EXPIRED_TOO_LONG'));
    assert.equal((await prepareAutoRenewChange({ ...intent, enabled: false })).enabled, false);
  });
  it('expired within the actual renewal window can enable without claiming renewal', async (t) => {
    fixture(t, { expiresAt: 900n });
    const plan = await prepareAutoRenewChange(intent);
    assert.equal(plan.observation.identity.lifecycle, 'expired');
    assert.equal(plan.enabled, true);
    assert.equal(plan.transaction.value, '0');
  });
  it('unsigned exact calldata uses the existing ERC-8021 helper and is deeply immutable', async (t) => {
    const f = fixture(t);
    const plan = await prepareAutoRenewChange(intent);
    assert.equal(plan.kind, 'set_auto_renew');
    assert.equal(plan.chainId, 8453);
    assert.equal(plan.transaction.to, vault);
    assert.equal(plan.transaction.value, '0');
    assert.equal(
      plan.transaction.data,
      encodeSetAutoRenewCalldata(BigInt(token), true, intent.builderCode),
    );
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.observation.vault));
    assert.throws(() => {
      plan.transaction.to = other;
    });
    assert.equal(f.sends.length, 0);
  });
  for (const input of [
    { ...intent, tokenId: 1 },
    { ...intent, tokenId: '01' },
    { ...intent, tokenId: '1e3' },
    { ...intent, tokenId: 'secretstring' },
    { ...intent, tokenId: '' },
    { ...intent, tokenId: (2n ** 256n).toString() },
    { ...intent, enabled: 'true' },
    { ...intent, builderCode: 'BAD' },
    { ...intent, expectedOwner: '0x123' },
    { ...intent, rpcUrl: 'https://attacker.invalid' },
  ])
    it(`rejects invalid change ${JSON.stringify(input)}`, async (t) => {
      const f = fixture(t);
      await assert.rejects(prepareAutoRenewChange(input), (error) => {
        assert.ok(errorCode('INVALID_INPUT')(error));
        assert.doesNotMatch(error.message, /secretstring|1e3|BigInt|SyntaxError/);
        return true;
      });
      assert.equal(f.calls.length, 0);
      assert.equal(f.sends.length, 0);
    });
  it('RPC details are sanitized and never become not-found or a quote', async (t) => {
    const f = fixture(t);
    f.controls.unavailable = true;
    await assert.rejects(inspectAgentRenewal({ tokenId: token }), (error) => {
      assert.equal(error.code, 'UNAVAILABLE');
      assert.doesNotMatch(error.message, /secret|https?:/);
      return true;
    });
  });
});

describe('explicit human approval and single wallet submission', { concurrency: false }, () => {
  it('requires a host approval function and respects rejection without a wallet call', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    assert.throws(
      () => executeAutoRenewChange(plan, { walletClient: f.wallet }),
      errorCode('APPROVAL_REQUIRED'),
    );
    const result = await executeAutoRenewChange(plan, {
      walletClient: f.wallet,
      approve: async () => false,
    });
    assert.equal(result.status, 'rejected');
    assert.equal(f.sends.length, 0);
  });
  it('reconstructs exact transaction fields and deduplicates simultaneous execution of the same plan', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    let approvals = 0;
    const options = {
      walletClient: f.wallet,
      approve: async (current) => {
        approvals++;
        assert.ok(Object.isFrozen(current.transaction));
        assert.equal(current.transaction.to, vault);
        return true;
      },
    };
    const [one, two] = await Promise.all([
      executeAutoRenewChange(plan, options),
      executeAutoRenewChange(plan, options),
    ]);
    assert.deepEqual(one, two);
    assert.equal(one.status, 'submitted');
    assert.equal(one.transactionHash, txHash);
    assert.equal(approvals, 1);
    assert.equal(f.sends.length, 1);
    const tx = f.sends[0];
    assert.deepEqual(Object.keys(tx).sort(), ['account', 'chain', 'data', 'to', 'value']);
    assert.equal(tx.account, owner);
    assert.equal(tx.chain.id, 8453);
    assert.equal(tx.value, 0n);
    assert.equal(tx.data, encodeSetAutoRenewCalldata(BigInt(token), true, intent.builderCode));
  });
  it('caches the attempt before synchronous wallet reentry can request another approval or send', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    let approvals = 0,
      reentered,
      entered = false;
    const options = {
      walletClient: f.wallet,
      approve: async () => {
        approvals++;
        return true;
      },
    };
    f.wallet.getChainId = () => {
      if (!entered) {
        entered = true;
        reentered = executeAutoRenewChange(plan, options);
      }
      return Promise.resolve(8453);
    };
    const first = executeAutoRenewChange(plan, options);
    const result = await first;
    assert.equal(reentered, first);
    assert.equal((await reentered).status, 'submitted');
    assert.equal(result.status, 'submitted');
    assert.equal(approvals, 1);
    assert.equal(f.sends.length, 1);
    assert.equal(await executeAutoRenewChange(plan, options), result);
    assert.equal(f.sends.length, 1);
  });
  for (const mutation of [
    (p) => {
      p.transaction.to = other;
    },
    (p) => {
      p.transaction.value = '1';
    },
    (p) => {
      p.transaction.data += '00';
    },
    (p) => {
      p.enabled = false;
    },
    (p) => {
      p.tokenId = '1';
    },
  ])
    it('a modified serialized plan never reaches approval or wallet submission', async (t) => {
      const f = fixture(t),
        plan = structuredClone(await prepareAutoRenewChange(intent));
      mutation(plan);
      let called = false;
      assert.throws(
        () =>
          executeAutoRenewChange(plan, {
            walletClient: f.wallet,
            approve: async () => {
              called = true;
              return true;
            },
          }),
        errorCode('PLAN_INVALID'),
      );
      assert.equal(called, false);
      assert.equal(f.sends.length, 0);
    });
  it('approval cannot redirect a captured intent by mutating the caller JSON plan', async (t) => {
    const f = fixture(t),
      plan = structuredClone(await prepareAutoRenewChange(intent)),
      id = plan.id;
    const result = await executeAutoRenewChange(plan, {
      walletClient: f.wallet,
      approve: async (fresh) => {
        assert.throws(() => {
          fresh.enabled = false;
        });
        plan.enabled = false;
        plan.transaction.to = other;
        plan.id = txHash;
        return true;
      },
    });
    assert.equal(result.status, 'submitted');
    assert.equal(result.planId, id);
    assert.equal(f.sends[0].to, vault);
    assert.equal(
      f.sends[0].data,
      encodeSetAutoRenewCalldata(BigInt(token), true, intent.builderCode),
    );
  });
  for (const mode of [
    'wrong-wallet',
    'wrong-chain',
    'transfer-during-approval',
    'revoked-during-approval',
    'reservation-during-approval',
    'expiry-during-approval',
    'chain-switch-during-approval',
  ])
    it(mode + ' does not send', async (t) => {
      const f = fixture(t),
        plan = await prepareAutoRenewChange(intent);
      if (mode === 'wrong-wallet') f.controls.addresses = [other];
      if (mode === 'wrong-chain') f.controls.walletChainId = 1;
      await assert.rejects(
        executeAutoRenewChange(plan, {
          walletClient: f.wallet,
          approve: async () => {
            if (mode === 'transfer-during-approval')
              f.advance({ owner: other, recordedOwner: other });
            if (mode === 'revoked-during-approval') f.advance({ revoked: true });
            if (mode === 'reservation-during-approval')
              f.advance({ pending: [3900000n, 2000n, 1000n] });
            if (mode === 'expiry-during-approval') f.advance({ now: 4000n });
            if (mode === 'chain-switch-during-approval') f.controls.walletChainId = 1;
            return true;
          },
        }),
      );
      assert.equal(f.sends.length, 0);
    });
  it('no-op comes from a fresh state read, not the old plan boolean', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    f.advance({ enabled: true });
    let approved = false;
    const result = await executeAutoRenewChange(plan, {
      walletClient: f.wallet,
      approve: async () => {
        approved = true;
        return true;
      },
    });
    assert.equal(result.status, 'no_change');
    assert.equal(result.observation.vault.autoRenewEnabled, true);
    assert.equal(approved, false);
    assert.equal(f.sends.length, 0);
  });
  it('an old no-op plan still performs owner checks before returning no-change', async (t) => {
    const f = fixture(t, { enabled: true }),
      plan = await prepareAutoRenewChange(intent);
    assert.equal(plan.noChange, true);
    f.advance({ owner: other, recordedOwner: other });
    await assert.rejects(
      executeAutoRenewChange(plan, { walletClient: f.wallet, approve: async () => true }),
      errorCode('OWNER_MISMATCH'),
    );
    assert.equal(f.sends.length, 0);
  });
  for (const mode of ['owner', 'wallet-chain', 'rpc-chain', 'flag'])
    it(`a settled no-change attempt is freshly checked after a ${mode} change`, async (t) => {
      const f = fixture(t, { enabled: true }),
        plan = await prepareAutoRenewChange(intent);
      let approvals = 0;
      const options = {
        walletClient: f.wallet,
        approve: async () => {
          approvals++;
          return true;
        },
      };
      const first = executeAutoRenewChange(plan, options);
      assert.equal((await first).status, 'no_change');
      const before = f.calls.length;
      if (mode === 'owner') f.advance({ owner: other, recordedOwner: other });
      if (mode === 'wallet-chain') f.controls.walletChainId = 1;
      if (mode === 'rpc-chain') f.controls.chainId = 1;
      if (mode === 'flag') f.advance({ enabled: false });
      const second = executeAutoRenewChange(plan, options);
      assert.notEqual(second, first);
      if (mode === 'flag') {
        assert.equal((await second).status, 'submitted');
        assert.equal(approvals, 1);
        assert.equal(f.sends.length, 1);
        assert.ok(f.calls.length > before);
      } else {
        await assert.rejects(
          second,
          errorCode(mode === 'owner' ? 'OWNER_MISMATCH' : 'WRONG_CHAIN'),
        );
        assert.equal(approvals, 0);
        assert.equal(f.sends.length, 0);
        if (mode !== 'wallet-chain') assert.ok(f.calls.length > before);
      }
    });
  it('a declined host approval stays cached even when explicitly invoked again', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    let approvals = 0;
    const options = {
      walletClient: f.wallet,
      approve: async () => {
        approvals++;
        return false;
      },
    };
    const first = executeAutoRenewChange(plan, options);
    assert.equal((await first).status, 'rejected');
    assert.equal(executeAutoRenewChange(plan, options), first);
    assert.equal(approvals, 1);
    assert.equal(f.sends.length, 0);
  });
  for (const [error, expected] of [
    [{ code: 4001 }, 'rejected'],
    [new Error('RPC response lost after broadcast'), 'submission_unknown'],
  ])
    it(expected + ' is not automatically retried or reported as confirmed failure', async (t) => {
      const f = fixture(t),
        plan = await prepareAutoRenewChange(intent);
      f.controls.submissionError = error;
      const options = { walletClient: f.wallet, approve: async () => true };
      const result = await executeAutoRenewChange(plan, options);
      assert.equal(result.status, expected);
      assert.equal(result.transactionHash, null);
      assert.deepEqual(await executeAutoRenewChange(plan, options), result);
      assert.equal(f.sends.length, 1);
    });
  it('an invalid wallet hash remains an unknown submission outcome', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    f.controls.returnedHash = 'bad';
    assert.equal(
      (await executeAutoRenewChange(plan, { walletClient: f.wallet, approve: async () => true }))
        .status,
      'submission_unknown',
    );
    assert.equal(f.sends.length, 1);
  });
  it('uses an explicitly supplied owner account without loading keys or bypassing approval', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    const account = {
      address: owner,
      type: 'local',
      signTransaction: () => {
        throw Error('SDK must delegate only to the wallet');
      },
    };
    f.wallet.account = account;
    let approved = false;
    const result = await executeAutoRenewChange(plan, {
      walletClient: f.wallet,
      approve: async () => {
        approved = true;
        return true;
      },
    });
    assert.equal(result.status, 'submitted');
    assert.equal(approved, true);
    assert.equal(f.sends[0].account, account);
  });
  it('a configured non-owner account cannot be overridden by a misleading address list', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    f.wallet.account = { address: other, type: 'json-rpc' };
    await assert.rejects(
      executeAutoRenewChange(plan, { walletClient: f.wallet, approve: async () => true }),
      errorCode('OWNER_MISMATCH'),
    );
    assert.equal(f.sends.length, 0);
  });
  it('an approval callback failure or wallet read error leaks no provider details and sends nothing', async (t) => {
    const f = fixture(t),
      plan = await prepareAutoRenewChange(intent);
    await assert.rejects(
      executeAutoRenewChange(plan, {
        walletClient: f.wallet,
        approve: async () => {
          throw Error('secret RPC https://private.invalid');
        },
      }),
      (error) => {
        assert.ok(errorCode('APPROVAL_REQUIRED')(error));
        assert.doesNotMatch(error.message, /secret|https?:/);
        return true;
      },
    );
    const fresh = await prepareAutoRenewChange(intent);
    f.wallet.getChainId = async () => {
      throw Error('secret RPC https://private.invalid');
    };
    await assert.rejects(
      executeAutoRenewChange(fresh, { walletClient: f.wallet, approve: async () => true }),
      (error) => {
        assert.ok(errorCode('UNAVAILABLE')(error));
        assert.doesNotMatch(error.message, /secret|https?:/);
        return true;
      },
    );
    assert.equal(f.sends.length, 0);
  });
});

describe(
  'receipt and actual safe readback, not registrar completion',
  { concurrency: false },
  () => {
    async function submitted(t, options = {}) {
      const f = fixture(t),
        plan = await prepareAutoRenewChange(intent);
      await executeAutoRenewChange(plan, { walletClient: f.wallet, approve: async () => true });
      if (!options.unmined) f.mine(options);
      return { f, plan };
    }
    it('confirms only the exact successful flag transaction and matching safe readback', async (t) => {
      const { f, plan } = await submitted(t);
      const result = await confirmAutoRenewChange(plan, txHash);
      assert.equal(result.status, 'confirmed');
      assert.equal(result.code, 'FLAG_CONFIRMED');
      assert.equal(result.action, 'set_auto_renew');
      assert.equal(result.observation.vault.autoRenewEnabled, true);
      assert.equal(result.observation.vault.lastRenewedAt, '0');
      assert.equal(f.sends.length, 1);
    });
    for (const newer of [false, true])
      it(`does not confirm an identical receipt ${newer ? 'before' : 'at'} the plan observation block`, async (t) => {
        const { f } = await submitted(t);
        if (newer) f.advance({ enabled: false });
        const laterPlan = await prepareAutoRenewChange(intent);
        if (newer) {
          assert.equal(laterPlan.noChange, false);
          f.advance({ enabled: true });
        }
        const result = await confirmAutoRenewChange(laterPlan, txHash);
        assert.equal(result.status, 'unverified');
        assert.equal(result.code, 'TRANSACTION_MISMATCH');
        assert.equal(f.sends.length, 1, 'the later plan was never submitted');
      });
    for (const [name, mutate] of [
      [
        'absent observation',
        (p) => {
          p.observation = null;
        },
      ],
      [
        'absent identity',
        (p) => {
          p.observation.identity = {};
        },
      ],
      [
        'absent block',
        (p) => {
          delete p.observation.identity.block;
        },
      ],
      [
        'numeric block',
        (p) => {
          p.observation.identity.block.number = 50000000;
        },
      ],
      [
        'malformed decimal',
        (p) => {
          p.observation.identity.block.number = '1e3';
        },
      ],
      [
        'oversized decimal',
        (p) => {
          p.observation.identity.block.number = (2n ** 256n).toString();
        },
      ],
      [
        'non-safe tag',
        (p) => {
          p.observation.identity.block.tag = 'latest';
        },
      ],
      [
        'invalid hash',
        (p) => {
          p.observation.identity.block.hash = '0x1234';
        },
      ],
      [
        'invalid timestamp',
        (p) => {
          p.observation.identity.block.timestamp = '-1';
        },
      ],
      [
        'foreign chain',
        (p) => {
          p.observation.identity.chainId = 1;
        },
      ],
      [
        'foreign token',
        (p) => {
          p.observation.identity.tokenId = '1';
        },
      ],
    ])
      it(`rejects a rehashed plan with ${name} before any confirmation RPC`, async (t) => {
        const f = fixture(t),
          plan = structuredClone(await prepareAutoRenewChange(intent));
        mutate(plan);
        rehashPlan(plan);
        const before = f.calls.length;
        await assert.rejects(confirmAutoRenewChange(plan, txHash), errorCode('PLAN_INVALID'));
        assert.throws(
          () => executeAutoRenewChange(plan, { walletClient: f.wallet, approve: async () => true }),
          errorCode('PLAN_INVALID'),
        );
        assert.equal(f.calls.length, before);
        assert.equal(f.sends.length, 0);
      });
    it('captures the validated plan block before asynchronous confirmation callbacks', async (t) => {
      const { f } = await submitted(t);
      const laterPlan = structuredClone(await prepareAutoRenewChange(intent));
      const observed = laterPlan.observation.identity.block.number;
      const result = await confirmAutoRenewChange(laterPlan, txHash, {
        publicClient: {
          ccipRead: false,
          getChainId: async () => {
            laterPlan.observation.identity.block.number = '1';
            return 8453;
          },
          getTransactionReceipt: async () => ({ ...f.receipt(), blockNumber: BigInt(observed) }),
          getTransaction: async () => ({
            hash: txHash,
            blockHash: f.receipt().blockHash,
            blockNumber: BigInt(observed),
            from: owner,
            to: vault,
            value: 0n,
            input: laterPlan.transaction.data,
            chainId: 8453,
          }),
          getBlock: async () => assert.fail('old receipts must be rejected before block reads'),
        },
      });
      assert.equal(result.status, 'unverified');
      assert.equal(result.code, 'TRANSACTION_MISMATCH');
      assert.equal(f.sends.length, 1);
    });
    it('requires the exact event token and enabled value, not a generic successful receipt', async (t) => {
      const { f, plan } = await submitted(t);
      const log = f.receipt().logs[0];
      for (const change of [
        { data: encodeAbiParameters([{ type: 'bool' }], [false]) },
        {
          topics: encodeEventTopics({
            abi: RENEWAL_WORKFLOW_ABI,
            eventName: 'AutoRenewToggled',
            args: { tokenId: 1n },
          }),
        },
        { removed: true },
        { transactionHash: '0x' + 'aa'.repeat(32) },
      ]) {
        f.controls.receiptPatch = { logs: [{ ...log, ...change }] };
        const result = await confirmAutoRenewChange(plan, txHash);
        assert.equal(result.status, 'unverified');
        assert.equal(result.code, 'TRANSACTION_MISMATCH');
      }
      assert.equal(f.sends.length, 1);
    });
    it('missing or unsafe receipt stays pending; safe advancement later permits confirmation', async (t) => {
      const { f, plan } = await submitted(t, { unmined: true });
      assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'pending');
      f.mine({ unsafe: true });
      const unsafe = await confirmAutoRenewChange(plan, txHash);
      assert.equal(unsafe.status, 'pending');
      assert.equal(unsafe.code, 'NOT_SAFE_YET');
      f.makeSafe();
      assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'confirmed');
      assert.equal(f.sends.length, 1);
    });
    it('only a canonical safe reverted receipt establishes a revert', async (t) => {
      const { f, plan } = await submitted(t, { reverted: true });
      assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'reverted');
      f.controls.wrongReceiptCanonical = true;
      assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'pending');
    });
    it('a same-height foreign safe readback never confirms the receipt from another fork', async (t) => {
      const { f, plan } = await submitted(t);
      f.forkReadbackAtSameHeight();
      const result = await confirmAutoRenewChange(plan, txHash);
      assert.equal(result.status, 'pending');
      assert.equal(result.code, 'NOT_SAFE_YET');
      assert.equal(f.sends.length, 1);
    });
    it('even a revert is not final when the safe head at that height has a different hash', async (t) => {
      const { f, plan } = await submitted(t, { reverted: true });
      f.forkReadbackAtSameHeight();
      f.controls.firstSafeForeign = true;
      assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'pending');
    });
    for (const patch of [
      { from: other },
      { to: other },
      { value: '0x1' },
      { input: '0x1234' },
      { chainId: '0x1' },
      { hash: '0x' + 'ab'.repeat(32) },
    ])
      it('rejects a mismatched actual transaction ' + Object.keys(patch)[0], async (t) => {
        const { f, plan } = await submitted(t);
        f.controls.txPatch = patch;
        const result = await confirmAutoRenewChange(plan, txHash);
        assert.equal(result.status, 'unverified');
        assert.equal(result.code, 'TRANSACTION_MISMATCH');
        assert.equal(f.sends.length, 1);
      });
    for (const patch of [{ from: other }, { to: other }, { logs: [] }])
      it('does not confirm a mismatched receipt ' + Object.keys(patch)[0], async (t) => {
        const { f, plan } = await submitted(t);
        f.controls.receiptPatch = patch;
        assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'unverified');
      });
    it('a later flag change or transfer is a readback mismatch, not a failed original transaction', async (t) => {
      const { f, plan } = await submitted(t);
      f.advance({ enabled: false });
      const result = await confirmAutoRenewChange(plan, txHash);
      assert.equal(result.status, 'unverified');
      assert.equal(result.code, 'READBACK_MISMATCH');
      f.advance({ enabled: true, owner: other, recordedOwner: other });
      assert.equal((await confirmAutoRenewChange(plan, txHash)).code, 'READBACK_MISMATCH');
    });
    it('unavailable receipts and wrong RPC chain never become a successful or failed renewal', async (t) => {
      const { f, plan } = await submitted(t);
      f.controls.receiptError = true;
      const missing = await confirmAutoRenewChange(plan, txHash);
      assert.equal(missing.status, 'unverified');
      assert.equal(missing.code, 'UNAVAILABLE');
      f.controls.receiptError = false;
      f.controls.chainId = 1;
      assert.equal((await confirmAutoRenewChange(plan, txHash)).status, 'unverified');
      assert.equal(f.sends.length, 1);
    });
  },
);
