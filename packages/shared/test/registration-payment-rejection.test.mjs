import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import rejection from './fixtures/registration-payment-rejection.json' with { type: 'json' };
import { registrationPaymentRejectionSchema } from '../dist/index.js';
import { registrationPaymentRejectionSchema as subpathSchema } from '../dist/schemas.js';

describe('public registration payment rejection contract', () => {
  it('accepts the actual backend JSON shape, including the matching error alias', () => {
    assert.equal(registrationPaymentRejectionSchema, subpathSchema);
    assert.deepEqual(registrationPaymentRejectionSchema.parse(rejection), rejection);
  });

  it('supports an omitted alias without requiring a particular server code', () => {
    const { error: _alias, ...withoutAlias } = rejection;
    assert.deepEqual(registrationPaymentRejectionSchema.parse(withoutAlias), withoutAlias);
    const futureCode = {
      ...rejection,
      error: 'NEW_TERMINAL_DECLINE',
      code: 'NEW_TERMINAL_DECLINE',
    };
    assert.deepEqual(registrationPaymentRejectionSchema.parse(futureCode), futureCode);
  });

  for (const error of [null, false, 0, '', 'PAYMENT_STATUS_UNCERTAIN', `${rejection.code} `]) {
    it(`rejects a conflicting error alias ${JSON.stringify(error)}`, () => {
      assert.equal(
        registrationPaymentRejectionSchema.safeParse({ ...rejection, error }).success,
        false,
      );
    });
  }

  it('compares aliases without normalizing conflicting codes into agreement', () => {
    assert.equal(
      registrationPaymentRejectionSchema.safeParse({ ...rejection, code: ` ${rejection.code}` })
        .success,
      false,
    );
  });

  for (const field of [
    'paymentStatus',
    'status',
    'settled',
    'settlementAttempted',
    'paymentIdentifier',
    'paymentTxHash',
    'txHash',
    'registrationId',
    'amountPaid',
    'refundEligible',
    'details',
  ]) {
    it(`does not strip an extra ${field} field to manufacture conclusive evidence`, () => {
      for (const value of ['settled', true, null, {}]) {
        assert.equal(
          registrationPaymentRejectionSchema.safeParse({ ...rejection, [field]: value }).success,
          false,
        );
      }
    });
  }

  for (const paymentSubmission of [
    undefined,
    null,
    {},
    { status: 'rejected' },
    { settlementAttempted: false },
    { status: 'unknown', settlementAttempted: false },
    { status: 'rejected', settlementAttempted: true },
    { status: 'rejected', settlementAttempted: 'false' },
    { status: 'rejected', settlementAttempted: 0 },
    { ...rejection.paymentSubmission, txHash: '0x1234' },
    { ...rejection.paymentSubmission, settled: false },
  ]) {
    it(`rejects malformed or contradictory nested evidence ${JSON.stringify(paymentSubmission)}`, () => {
      assert.equal(
        registrationPaymentRejectionSchema.safeParse({ ...rejection, paymentSubmission }).success,
        false,
      );
    });
  }

  it('requires nonblank string codes and messages and a complete object', () => {
    for (const field of ['code', 'message']) {
      for (const value of [undefined, null, false, 123, '', ' \n\t']) {
        assert.equal(
          registrationPaymentRejectionSchema.safeParse({ ...rejection, [field]: value }).success,
          false,
        );
      }
    }
    for (const value of [undefined, null, false, 123, rejection.code, [], {}]) {
      assert.equal(registrationPaymentRejectionSchema.safeParse(value).success, false);
    }
  });
});
