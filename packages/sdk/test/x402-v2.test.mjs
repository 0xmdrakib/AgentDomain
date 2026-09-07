import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
} from '@x402/core/http';
import { BUILDER_CODE, declareBuilderCodeExtension } from '@x402/extensions/builder-code';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createX402PaymentHeaders } from '../dist/index.js';

const network = 'eip155:8453';
const payer = '0x1111111111111111111111111111111111111111';
const payTo = '0x2222222222222222222222222222222222222222';
const asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function paymentRequired(amount = '100000') {
  return {
    x402Version: 2,
    resource: {
      url: 'https://agentdomain.app/api/v1/agents/register',
      description: 'Register an AgentDomain identity',
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network,
        asset,
        amount,
        payTo,
        maxTimeoutSeconds: 300,
        extra: {
          name: 'USD Coin',
          version: '2',
          requestBinding: `0x${'ab'.repeat(32)}`,
        },
      },
    ],
  };
}

describe('AgentDomain x402 v2 client', () => {
  it('creates a standard Base mainnet PAYMENT-SIGNATURE header', async () => {
    const challenge = paymentRequired();
    const response = new Response(JSON.stringify(challenge), {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) },
    });
    let signed = false;
    const walletClient = {
      account: { address: payer },
      signTypedData: async () => {
        signed = true;
        return `0x${'11'.repeat(65)}`;
      },
    };

    const headers = await createX402PaymentHeaders(response, walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed, true);
    assert.equal(payload.x402Version, 2);
    assert.equal(payload.accepted.network, network);
    assert.equal(payload.accepted.amount, '100000');
    assert.equal(payload.accepted.payTo, payTo);
    assert.equal(payload.payload.authorization.nonce, `0x${'ab'.repeat(32)}`);
  });

  it('signs an above-$1 exact authorization with request binding and extension echo', async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('Payment signing must not fetch'));
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const challenge = {
      ...paymentRequired('12345678'),
      extensions: {
        [BUILDER_CODE]: declareBuilderCodeExtension('agentdomain_test'),
      },
    };
    const response = new Response(JSON.stringify(challenge), {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) },
    });
    const signed = [];
    const walletClient = {
      account,
      signTypedData: async (parameters) => {
        signed.push(parameters);
        return account.signTypedData(parameters);
      },
    };

    const headers = await createX402PaymentHeaders(response, walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);
    const authorization = payload.payload.authorization;
    const requestBinding = challenge.accepts[0].extra.requestBinding;

    assert.equal(payload.x402Version, 2);
    assert.deepEqual(payload.accepted, challenge.accepts[0]);
    assert.deepEqual(payload.extensions, challenge.extensions);
    assert.equal(authorization.from, account.address);
    assert.equal(authorization.to, payTo);
    assert.equal(authorization.value, '12345678');
    assert.equal(authorization.validAfter, '0');
    assert.equal(authorization.nonce, requestBinding);
    assert.equal(signed.length, 2);

    const expectedTypedData = {
      domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: asset },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: account.address,
        to: payTo,
        value: 12345678n,
        validAfter: 0n,
        validBefore: BigInt(authorization.validBefore),
        nonce: requestBinding,
      },
    };
    const { account: signingAccount, ...finalTypedData } = signed.at(-1);
    assert.equal(signingAccount.address, account.address);
    assert.deepEqual(finalTypedData, expectedTypedData);
    assert.equal(
      await recoverTypedDataAddress({
        ...expectedTypedData,
        signature: payload.payload.signature,
      }),
      account.address,
    );
  });

  for (const unsupportedNetwork of ['eip155:1', 'eip155:84532']) {
    it(`rejects ${unsupportedNetwork} before signing`, async (t) => {
      t.mock.method(globalThis, 'fetch', () => assert.fail('Rejected payments must not fetch'));
      const challenge = paymentRequired('12345678');
      challenge.accepts[0].network = unsupportedNetwork;
      const response = new Response(JSON.stringify(challenge), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) },
      });
      const walletClient = {
        account: { address: payer },
        signTypedData: async () => assert.fail('Unsupported networks must not be signed'),
      };

      await assert.rejects(
        createX402PaymentHeaders(response, walletClient),
        /No network\/scheme registered/,
      );
    });
  }

  it('rejects a v1 body challenge before signing', async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('Rejected payments must not fetch'));
    const challenge = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          asset,
          maxAmountRequired: '12345678',
          payTo,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        },
      ],
    };
    const response = new Response(JSON.stringify(challenge), { status: 402 });
    const walletClient = {
      account: { address: payer },
      signTypedData: async () => assert.fail('Version 1 payments must not be signed'),
    };

    await assert.rejects(
      createX402PaymentHeaders(response, walletClient),
      /AgentDomain requires x402 v2; server returned v1\./,
    );
  });

  it('round-trips a base64 PAYMENT-REQUIRED header', () => {
    const challenge = paymentRequired('1');
    const encoded = encodePaymentRequiredHeader(challenge);

    assert.equal(encoded.trim().startsWith('{'), false);
    assert.deepEqual(decodePaymentRequiredHeader(encoded), challenge);
  });

  it('preserves the resource server standard builder-code extension', async () => {
    const challenge = {
      ...paymentRequired('1'),
      extensions: {
        [BUILDER_CODE]: declareBuilderCodeExtension('agentdomain_test'),
      },
    };
    const response = new Response(JSON.stringify(challenge), {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) },
    });
    const walletClient = {
      account: { address: payer },
      signTypedData: async () => `0x${'11'.repeat(65)}`,
    };

    const headers = await createX402PaymentHeaders(response, walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(payload.x402Version, 2);
    assert.deepEqual(payload.extensions?.[BUILDER_CODE]?.info, { a: 'agentdomain_test' });
  });
});
