import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registrationProgressSchema } from '../dist/schemas.js';

const progress = {
  registrationId: 'example-registration',
  status: 'failed',
  statusUrl: '/api/v1/registrations/example-registration',
  domain: 'example.com',
  agentId: null,
  paymentStatus: 'not_charged',
  stage: 'payment',
  messageCode: 'PAYMENT_NOT_SUBMITTED',
  startedAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:01:00.000Z',
  completedAt: null,
  revision: 2,
  estimatedDurationSeconds: null,
  pollAfterSeconds: 30,
  completionEventId: null,
  result: null,
};

test('preserves the optional exact payment reference without breaking older status responses', () => {
  const paymentReference = `0x${'1a'.repeat(32)}`;
  assert.equal(
    registrationProgressSchema.parse({ ...progress, paymentReference }).paymentReference,
    paymentReference,
  );
  assert.equal(registrationProgressSchema.parse(progress).paymentReference, undefined);
  for (const invalid of [null, '', '1a'.repeat(32), `0x${'g'.repeat(64)}`, `0x${'1'.repeat(63)}`]) {
    assert.equal(
      registrationProgressSchema.safeParse({ ...progress, paymentReference: invalid }).success,
      false,
    );
  }
});
