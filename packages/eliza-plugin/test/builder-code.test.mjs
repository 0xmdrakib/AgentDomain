import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parseBuilderCodeAttribution } from '@agentdomain/sdk';
import { registrationResultSchema } from '@agentdomain/shared';
import { encodeElizaAutoRenewCalldata, registerIdentityAction } from '../dist/index.js';

const vault = '0x2222222222222222222222222222222222222222';
const txHash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'01'.repeat(32)}`;
const privateKey = `0x${'11'.repeat(32)}`;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function transactionReceipt(status) {
  return {
    blockHash,
    blockNumber: '0x1',
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    from: '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a',
    gasUsed: '0x5208',
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: status === 'success' ? '0x1' : '0x0',
    to: vault,
    transactionHash: txHash,
    transactionIndex: '0x0',
    type: '0x2',
  };
}

function block() {
  return {
    baseFeePerGas: '0x1',
    difficulty: '0x0',
    extraData: '0x',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    hash: blockHash,
    logsBloom: `0x${'00'.repeat(256)}`,
    miner: '0x0000000000000000000000000000000000000000',
    mixHash: `0x${'00'.repeat(32)}`,
    nonce: '0x0000000000000000',
    number: '0x1',
    parentHash: `0x${'00'.repeat(32)}`,
    receiptsRoot: `0x${'00'.repeat(32)}`,
    sha3Uncles: `0x${'00'.repeat(32)}`,
    size: '0x1',
    stateRoot: `0x${'00'.repeat(32)}`,
    timestamp: '0x1',
    totalDifficulty: '0x0',
    transactions: [],
    transactionsRoot: `0x${'00'.repeat(32)}`,
    uncles: [],
  };
}

function pendingTransaction() {
  return {
    blockHash: null,
    blockNumber: null,
    from: '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a',
    gas: '0x186a0',
    hash: txHash,
    input: '0x',
    maxFeePerGas: '0x2',
    maxPriorityFeePerGas: '0x1',
    nonce: '0x0',
    r: `0x${'01'.repeat(32)}`,
    s: `0x${'02'.repeat(32)}`,
    to: vault,
    transactionIndex: null,
    type: '0x2',
    v: '0x0',
    value: '0x0',
  };
}

function mockRegistrationWithReceipt(status) {
  let receiptRequests = 0;
  const registration = registrationResultSchema.parse({
    registrationId: '11111111-1111-4111-8111-111111111111',
    agentId: '22222222-2222-4222-8222-222222222222',
    domain: 'receipt-test.xyz',
    nftTokenId: 9,
    basename: null,
    ensName: null,
    txHash,
    sslStatus: 'active',
    estimatedReadyAt: '2026-09-06T00:00:00.000Z',
    metadataUri: 'ipfs://synthetic-registration-fixture',
    provisioningStatus: 'completed',
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/agents/register')) {
      return new Response(JSON.stringify(registration), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestBody = JSON.parse(String(init.body));
    const requests = Array.isArray(requestBody) ? requestBody : [requestBody];
    const responses = requests.map((request) => {
      if (request.method === 'eth_getTransactionReceipt') {
        receiptRequests += 1;
      }
      if (
        request.method === 'eth_getTransactionReceipt' &&
        status === 'confirmation-error' &&
        receiptRequests > 1
      ) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32000, message: 'confirmation unavailable' },
        };
      }
      let result;
      switch (request.method) {
        case 'eth_chainId':
          result = '0x2105';
          break;
        case 'eth_blockNumber':
          result = '0x1';
          break;
        case 'eth_estimateGas':
          result = '0x186a0';
          break;
        case 'eth_getBlockByNumber':
          result = block();
          break;
        case 'eth_getTransactionCount':
          result = '0x0';
          break;
        case 'eth_getTransactionByHash':
          result = pendingTransaction();
          break;
        case 'eth_maxPriorityFeePerGas':
          result = '0x1';
          break;
        case 'eth_sendRawTransaction':
          result = txHash;
          break;
        case 'eth_getTransactionReceipt':
          result = status === 'confirmation-error' ? null : transactionReceipt(status);
          break;
        default:
          throw new Error(`Unexpected RPC method ${request.method}`);
      }
      return { jsonrpc: '2.0', id: request.id, result };
    });
    return new Response(JSON.stringify(Array.isArray(requestBody) ? responses : responses[0]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function runtime() {
  const settings = {
    AGENTDOMAIN_API_URL: 'https://example.test/api/v1',
    AGENTDOMAIN_BUILDER_CODE: 'eliza_test',
    AGENTDOMAIN_NETWORK: 'base',
    AGENT_PRIVATE_KEY: privateKey,
    BASE_RPC_URL: 'https://base-rpc.example.test',
    RENEWAL_VAULT_ADDRESS: vault,
  };
  return { getSetting: (key) => settings[key] };
}

describe('Eliza direct Base attribution', () => {
  it('reports registration auto-renew enabled only after a successful receipt', async () => {
    mockRegistrationWithReceipt('success');

    const result = await registerIdentityAction.handler(runtime(), {
      content: { text: 'Register receipt-test.xyz with auto-renew' },
    });

    assert.match(result.text, /Auto-renew enabled via tx/);
  });

  it('returns a clear registration auto-renew failure when the receipt reverted', async () => {
    mockRegistrationWithReceipt('reverted');

    const result = await registerIdentityAction.handler(runtime(), {
      content: { text: 'Register receipt-test.xyz with auto-renew' },
    });

    assert.doesNotMatch(result.text, /Auto-renew enabled/);
    assert.match(result.text, /confirmed with status reverted; auto-renew was not enabled/);
  });

  it('returns a clear registration auto-renew failure when confirmation fails', async () => {
    mockRegistrationWithReceipt('confirmation-error');

    const result = await registerIdentityAction.handler(runtime(), {
      content: { text: 'Register receipt-test.xyz with auto-renew' },
    });

    assert.doesNotMatch(result.text, /Auto-renew enabled/);
    assert.match(result.text, /submitted but confirmation failed or remained pending/);
  });

  it('encodes the runtime-provided builder code into auto-renew calldata', () => {
    const data = encodeElizaAutoRenewCalldata(9n, 'eliza_test');
    assert.deepEqual(parseBuilderCodeAttribution(data), { a: 'eliza_test' });
  });

  it('fails safely when the runtime has no builder code', () => {
    assert.throws(() => encodeElizaAutoRenewCalldata(9n), /AGENTDOMAIN_BUILDER_CODE/);
  });
});
