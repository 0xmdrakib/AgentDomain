import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
} from '@x402/core/http';
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
        extra: { name: 'USD Coin', version: '2' },
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
  });

  it('round-trips a base64 PAYMENT-REQUIRED header', () => {
    const challenge = paymentRequired('1');
    const encoded = encodePaymentRequiredHeader(challenge);

    assert.equal(encoded.trim().startsWith('{'), false);
    assert.deepEqual(decodePaymentRequiredHeader(encoded), challenge);
  });
});
