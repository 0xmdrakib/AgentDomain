import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emailAddressChangeSchema,
  emailAddressChangeStatusSchema,
  emailAddressChangeResultSchema,
  emailServiceStatusSchema,
} from '../dist/schemas.js';

test('public address status does not equate native projection with completion', () => {
  const base = {
    requestId: '11111111-1111-4111-8111-111111111111',
    action: 'primary-rename',
    target: 'new@example.test',
  };
  for (const phase of [
    'pending',
    'fenced',
    'applying',
    'uncertain',
    'rejected',
    'native_applied',
    'projected',
    'completed',
    'cancelled',
  ])
    assert.equal(emailAddressChangeSchema.parse({ ...base, phase }).phase, phase);
  assert.equal(emailAddressChangeSchema.safeParse({ ...base, phase: 'ready' }).success, false);
  assert.equal(
    emailAddressChangeSchema.safeParse({ ...base, phase: 'pending', privateKey: 'forbidden' })
      .success,
    false,
  );
});

test('unchecked service status cannot be mistaken for checked readiness', () => {
  assert.deepEqual(emailServiceStatusSchema.parse({ state: 'unchecked' }), {
    state: 'unchecked',
  });
  assert.equal(emailServiceStatusSchema.safeParse({ state: 'ready' }).success, false);
  assert.equal(emailServiceStatusSchema.safeParse({ state: 'provider-managed' }).success, true);
});

test('an unavailable GET status is explicit and never a mutation acceptance', () => {
  assert.deepEqual(emailAddressChangeStatusSchema.parse({ phase: 'unavailable' }), {
    phase: 'unavailable',
  });
  assert.equal(
    emailAddressChangeResultSchema.safeParse({ change: { phase: 'unavailable' } }).success,
    false,
  );
});
