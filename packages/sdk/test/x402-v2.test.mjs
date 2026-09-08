import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
} from '@x402/core/http';
import { BUILDER_CODE, declareBuilderCodeExtension } from '@x402/extensions/builder-code';
import { maxUint256, recoverTypedDataAddress } from 'viem';
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

function challengeResponse(challenge, body = challenge) {
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) },
  });
}

function localWallet(t) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Payment signing must not fetch'));
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const signed = [];
  return {
    account,
    signed,
    walletClient: {
      account,
      signTypedData: async (parameters) => {
        signed.push(parameters);
        return account.signTypedData(parameters);
      },
    },
  };
}

describe('AgentDomain x402 v2 client', () => {
  it('creates a standard Base mainnet PAYMENT-SIGNATURE header', async () => {
    const challenge = paymentRequired();
    const response = new Response(JSON.stringify(challenge), {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) },
    });
    let signed = 0;
    const walletClient = {
      account: { address: payer },
      signTypedData: async () => {
        signed += 1;
        return `0x${'11'.repeat(65)}`;
      },
    };

    const headers = await createX402PaymentHeaders(response, walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed, 1);
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
    assert.deepEqual(payload.resource, challenge.resource);
    assert.deepEqual(payload.extensions, challenge.extensions);
    assert.equal(authorization.from, account.address);
    assert.equal(authorization.to, payTo);
    assert.equal(authorization.value, '12345678');
    assert.equal(authorization.validAfter, '0');
    assert.equal(authorization.nonce, requestBinding);
    assert.equal(signed.length, 1);

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
    assert.notEqual(
      await recoverTypedDataAddress({
        ...expectedTypedData,
        message: { ...expectedTypedData.message, nonce: `0x${'cd'.repeat(32)}` },
        signature: payload.payload.signature,
      }),
      account.address,
      'The signature must not validate for a different request binding',
    );
  });

  for (const maxTimeoutSeconds of [1, 120, 300, 900, 86400]) {
    for (const bound of [true, false]) {
      it(`preserves the issued ${maxTimeoutSeconds}s timeout and amount (${bound ? 'bound' : 'unbound'})`, async (t) => {
        const now = 1_800_000_000;
        t.mock.method(Date, 'now', () => now * 1000);
        const { walletClient, signed } = localWallet(t);
        const challenge = paymentRequired('12345678');
        challenge.accepts[0].maxTimeoutSeconds = maxTimeoutSeconds;
        challenge.accepts[0].asset = asset.toLowerCase();
        challenge.accepts[0].extra.assetTransferMethod = 'eip3009';
        if (!bound) delete challenge.accepts[0].extra.requestBinding;

        const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
        const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

        assert.equal(signed.length, 1);
        assert.deepEqual(payload.accepted, challenge.accepts[0]);
        assert.deepEqual(payload.resource, challenge.resource);
        assert.equal(payload.payload.authorization.value, '12345678');
        assert.equal(payload.payload.authorization.validAfter, '0');
        assert.equal(payload.payload.authorization.validBefore, String(now + maxTimeoutSeconds));
        assert.equal(signed[0].message.validBefore, BigInt(now + maxTimeoutSeconds));
      });
    }
  }

  for (const amount of ['1000001', '2500000000', maxUint256.toString()]) {
    it(`signs the exact uint256 amount ${amount} once without an implicit $1 cap`, async (t) => {
      const { walletClient, signed } = localWallet(t);
      const challenge = paymentRequired(amount);
      const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
      const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

      assert.equal(signed.length, 1);
      assert.equal(signed[0].message.value, BigInt(amount));
      assert.equal(payload.payload.authorization.value, amount);
      assert.deepEqual(payload.accepted, challenge.accepts[0]);
    });
  }

  it('preserves unbound non-default asset support and signs a fresh nonce once per call', async (t) => {
    const { walletClient, account, signed } = localWallet(t);
    const challenge = paymentRequired('12345678');
    challenge.accepts[0].asset = '0x3333333333333333333333333333333333333333';
    challenge.accepts[0].extra = { name: 'Example Token', version: '1' };
    const nonces = [];
    for (let i = 0; i < 2; i += 1) {
      const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
      const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);
      assert.equal(signed.length, i + 1);
      assert.deepEqual(payload.accepted, challenge.accepts[0]);
      assert.match(payload.payload.authorization.nonce, /^0x[a-fA-F0-9]{64}$/);
      assert.equal(payload.payload.authorization.nonce, signed[i].message.nonce);
      assert.equal(
        await recoverTypedDataAddress({ ...signed[i], signature: payload.payload.signature }),
        account.address,
      );
      nonces.push(payload.payload.authorization.nonce);
    }
    assert.notEqual(nonces[0], nonces[1]);
  });

  it('keeps unbound Permit2 delegated to the upstream scheme', async (t) => {
    const { walletClient, signed } = localWallet(t);
    const challenge = paymentRequired('12345678');
    delete challenge.accepts[0].extra.requestBinding;
    challenge.accepts[0].extra.assetTransferMethod = 'permit2';
    const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed.length, 1);
    assert.equal(signed[0].primaryType, 'PermitWitnessTransferFrom');
    assert.deepEqual(payload.accepted, challenge.accepts[0]);
    assert.ok(payload.payload.permit2Authorization);
    assert.equal(payload.payload.authorization, undefined);
  });

  it('uses the issued header unchanged when the JSON body advertises different requirements', async (t) => {
    const { walletClient, signed } = localWallet(t);
    const header = paymentRequired('12345678');
    header.accepts[0].maxTimeoutSeconds = 900;
    const body = paymentRequired('99999999');
    body.accepts[0].extra.requestBinding = `0x${'cd'.repeat(32)}`;
    const headers = await createX402PaymentHeaders(challengeResponse(header, body), walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed.length, 1);
    assert.deepEqual(payload.accepted, header.accepts[0]);
    assert.equal(payload.payload.authorization.nonce, header.accepts[0].extra.requestBinding);
    assert.equal(payload.payload.authorization.value, header.accepts[0].amount);
  });

  it('echoes an opaque quote token and arbitrary extra fields unchanged across signing delay', async (t) => {
    let now = 1_800_000_000;
    t.mock.method(Date, 'now', () => now * 1000);
    const { walletClient, signed } = localWallet(t);
    const signTypedData = walletClient.signTypedData;
    walletClient.signTypedData = async (parameters) => {
      now += 20;
      return signTypedData(parameters);
    };
    const challenge = paymentRequired('6218032');
    Object.assign(challenge.accepts[0].extra, {
      quoteToken: 'opaque-test-token.with-encrypted-payload',
      registrationQuote: 'opaque-registration-checkout-envelope',
      quoteExpiresAt: new Date((now + 60) * 1000).toISOString(),
      quoteMetadata: { format: 1, fields: ['keep', 'unchanged'], optional: null },
    });
    const issuedRequirement = structuredClone(challenge.accepts[0]);
    const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed.length, 1);
    assert.deepEqual(payload.accepted, issuedRequirement);
    assert.deepEqual(payload.resource, challenge.resource);
    assert.equal(payload.payload.authorization.value, '6218032');
    assert.equal(payload.payload.authorization.nonce, issuedRequirement.extra.requestBinding);
    assert.equal(payload.payload.authorization.validBefore, String(1_800_000_000 + 60));
  });

  for (const quoteLifetime of [10, 300, 900]) {
    it(`caps the sole signature to a ${quoteLifetime}s quote without mutating accepted timeout`, async (t) => {
      const now = 1_800_000_000;
      t.mock.method(Date, 'now', () => now * 1000);
      const { walletClient, account, signed } = localWallet(t);
      const challenge = paymentRequired('6218032');
      challenge.accepts[0].extra.registrationQuote = 'opaque-sealed-quote';
      challenge.accepts[0].extra.quoteExpiresAt = new Date(
        (now + quoteLifetime) * 1000 + 999,
      ).toISOString();
      const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
      const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

      assert.equal(signed.length, 1);
      assert.deepEqual(payload.accepted, challenge.accepts[0]);
      assert.equal(payload.accepted.maxTimeoutSeconds, 300);
      assert.equal(
        payload.payload.authorization.validBefore,
        String(now + Math.min(300, quoteLifetime)),
      );
      assert.equal(
        signed[0].message.validBefore.toString(),
        payload.payload.authorization.validBefore,
      );
      assert.equal(payload.payload.authorization.nonce, challenge.accepts[0].extra.requestBinding);
      assert.equal(
        await recoverTypedDataAddress({ ...signed[0], signature: payload.payload.signature }),
        account.address,
      );
    });
  }

  it('does not renew the original quote or sign again when the wallet prompt outlasts expiry', async (t) => {
    let now = 1_800_000_000;
    t.mock.method(Date, 'now', () => now * 1000);
    const { walletClient, signed } = localWallet(t);
    const sign = walletClient.signTypedData;
    walletClient.signTypedData = async (parameters) => {
      now += 20;
      return sign(parameters);
    };
    const challenge = paymentRequired('6218032');
    challenge.accepts[0].extra.quoteExpiresAt = new Date((now + 10) * 1000).toISOString();
    const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed.length, 1);
    assert.equal(payload.payload.authorization.validBefore, '1800000010');
    assert.deepEqual(payload.accepted, challenge.accepts[0]);
  });

  it('accepts a valid timezone-offset quote expiry without normalizing the echoed field', async (t) => {
    t.mock.method(Date, 'now', () => Date.parse('2026-09-09T10:00:00.000Z'));
    const { walletClient, signed } = localWallet(t);
    const challenge = paymentRequired('6218032');
    challenge.accepts[0].extra.quoteExpiresAt = '2026-09-09T16:01:00+06:00';
    const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);
    assert.equal(signed.length, 1);
    assert.equal(
      payload.payload.authorization.validBefore,
      String(Date.parse('2026-09-09T10:01:00Z') / 1000),
    );
    assert.deepEqual(payload.accepted, challenge.accepts[0]);
  });

  for (const expiry of [
    null,
    1800001000000,
    '',
    'not-a-date',
    '2026-09-09',
    '2026-09-09T10:01:00',
    '2026-02-30T10:00:00.000Z',
    '2026-09-09T10:01:00+99:99',
    '2026-09-09T09:59:59.000Z',
    '2026-09-09T10:00:00.000Z',
    '2026-09-09T10:00:00.999Z',
  ]) {
    it(`rejects invalid or elapsed quote expiry ${JSON.stringify(expiry)} before prompting`, async (t) => {
      t.mock.method(Date, 'now', () => Date.parse('2026-09-09T10:00:00.000Z'));
      const { walletClient, signed } = localWallet(t);
      const challenge = paymentRequired('6218032');
      challenge.accepts[0].extra.quoteExpiresAt = expiry;
      await assert.rejects(
        createX402PaymentHeaders(challengeResponse(challenge), walletClient),
        /quote.*expir/i,
      );
      assert.equal(signed.length, 0);
    });
  }

  it('binds the selected supported offer, not the first unsupported offer', async (t) => {
    const { walletClient, signed } = localWallet(t);
    const challenge = paymentRequired('12345678');
    const expected = structuredClone(challenge.accepts[0]);
    const unsupported = paymentRequired('1').accepts[0];
    unsupported.network = 'eip155:1';
    unsupported.extra.requestBinding = 'invalid';
    challenge.accepts.unshift(unsupported);
    const headers = await createX402PaymentHeaders(challengeResponse(challenge), walletClient);
    const payload = decodePaymentSignatureHeader(headers['PAYMENT-SIGNATURE']);

    assert.equal(signed.length, 1);
    assert.deepEqual(payload.accepted, expected);
    assert.equal(payload.payload.authorization.nonce, expected.extra.requestBinding);
  });

  it('does not fall back to an unbound offer when the selected binding is invalid', async (t) => {
    const { walletClient, signed } = localWallet(t);
    const challenge = paymentRequired('12345678');
    challenge.accepts[0].extra.requestBinding = 'invalid';
    const unbound = paymentRequired('1').accepts[0];
    delete unbound.extra.requestBinding;
    challenge.accepts.push(unbound);

    await assert.rejects(
      createX402PaymentHeaders(challengeResponse(challenge), walletClient),
      /invalid x402 request binding/,
    );
    assert.equal(signed.length, 0);
  });

  const invalidFields = [
    [
      'network',
      ['eip155:1', 'eip155:84532', 'base', 'eip155:08453'],
      /No network\/scheme registered/,
    ],
    ['scheme', ['upto', 'EXACT'], /No network\/scheme registered/],
    ['asset', ['bad-address', payTo, undefined, null], /requires the Base USDC asset/],
    [
      'payTo',
      ['bad-address', '0x0000000000000000000000000000000000000000', undefined, null],
      /invalid x402 payTo/,
    ],
    [
      'amount',
      [
        '',
        '0',
        '-1',
        '1.5',
        '1e6',
        '0x10',
        ' 1',
        '1 ',
        'NaN',
        'Infinity',
        100000,
        null,
        undefined,
        (maxUint256 + 1n).toString(),
      ],
      /invalid x402 amount/,
    ],
    [
      'maxTimeoutSeconds',
      [0, -1, 1.5, '300', null, undefined, Number.MAX_SAFE_INTEGER],
      /invalid x402 authorization timeout/,
    ],
  ];
  const invalidExtras = [
    [
      'requestBinding',
      [
        '',
        'ab'.repeat(32),
        `0x${'ab'.repeat(31)}`,
        `0x${'ab'.repeat(33)}`,
        `0x${'gg'.repeat(32)}`,
        1,
        null,
        {},
      ],
      /invalid x402 request binding/,
    ],
    ['name', ['', 'Wrong Token', undefined, 1], /invalid Base USDC EIP-712 domain/],
    ['version', ['', '1', 2, undefined], /invalid Base USDC EIP-712 domain/],
    ['assetTransferMethod', ['permit2', 'unknown', null], /requires an EIP-3009/],
  ];
  for (const [fields, extra] of [
    [invalidFields, false],
    [invalidExtras, true],
  ]) {
    for (const [field, values, error] of fields) {
      for (const value of values) {
        it(`rejects bound ${extra ? 'extra.' : ''}${field}=${JSON.stringify(value)} before prompting`, async (t) => {
          const { walletClient, signed } = localWallet(t);
          const challenge = paymentRequired('12345678');
          const target = extra ? challenge.accepts[0].extra : challenge.accepts[0];
          target[field] = value;
          await assert.rejects(
            createX402PaymentHeaders(challengeResponse(challenge), walletClient),
            error,
          );
          assert.equal(signed.length, 0);
        });
      }
    }
  }

  it('propagates wallet rejection without retrying or signing an unbound fallback', async (t) => {
    const { walletClient, signed } = localWallet(t);
    const rejected = new Error('User rejected the signature');
    walletClient.signTypedData = async (parameters) => {
      signed.push(parameters);
      throw rejected;
    };
    await assert.rejects(
      createX402PaymentHeaders(challengeResponse(paymentRequired()), walletClient),
      (error) => error === rejected,
    );
    assert.equal(signed.length, 1);
    assert.equal(signed[0].message.nonce, paymentRequired().accepts[0].extra.requestBinding);
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
