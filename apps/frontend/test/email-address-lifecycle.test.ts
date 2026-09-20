import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmailAddressChange } from '@agentdomain/shared';
import {
  activeEmailAddresses,
  addressChangeLabel,
  addressControlsBlocked,
  addressMutationRequest,
  emailSendAllowed,
  emailFromCanReconcile,
  initialEmailAddressState,
  invalidateEmailObservation,
  isAddressChangeTerminal,
  observeEmailAddresses,
  readAddressMutation,
  reconcileEmailFrom,
  type AddressRequest,
} from '../src/lib/email-address-lifecycle';

const agentId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const inbox = {
  id: 'inbox',
  agentId,
  emailAddress: 'agent@example.test',
  verificationStatus: 'Success',
  dkimConfigured: true,
  spfConfigured: true,
  dmarcConfigured: true,
  createdAt: '2026-09-20T00:00:00.000Z',
};
const primary = {
  id: 'primary',
  agentId,
  emailAddress: inbox.emailAddress,
  kind: 'primary' as const,
  status: 'active' as const,
  createdAt: inbox.createdAt,
  updatedAt: inbox.createdAt,
};
const alias = {
  ...primary,
  id: 'alias',
  kind: 'alias' as const,
  emailAddress: 'billing@example.test',
};
const request: AddressRequest = { requestId, action: 'alias-create', target: alias.emailAddress };
const change = (phase: EmailAddressChange['phase']): EmailAddressChange => ({ ...request, phase });
const ready = {
  state: 'ready' as const,
  checkedAt: inbox.createdAt,
};
const observed = () =>
  observeEmailAddresses(
    initialEmailAddressState(),
    {
      inbox,
      addresses: [primary, alias],
      addressChange: null,
      mailStatus: ready,
    },
    agentId,
    true,
  ).state;

test('legacy absent addresses differs from an authoritative empty/deleted address list', () => {
  assert.deepEqual(
    activeEmailAddresses(undefined, inbox).map((v) => v.emailAddress),
    [primary.emailAddress],
  );
  assert.deepEqual(activeEmailAddresses([], inbox), []);
  assert.deepEqual(activeEmailAddresses([{ ...primary, status: 'deleted' }], inbox), []);
  let state = observeEmailAddresses(
    initialEmailAddressState(),
    { inbox, addresses: [] },
    agentId,
    false,
  ).state;
  state = observeEmailAddresses(state, { inbox }, agentId, false).state;
  assert.deepEqual(activeEmailAddresses(state.addresses, inbox), []);
});

test('From reconciliation preserves an active selection and drops a deleted one without changing draft fields', () => {
  const draft = {
    to: 'customer@example.test',
    fromAddress: alias.emailAddress,
    subject: 'Draft',
    text: 'Keep this body.',
  };
  assert.equal(
    reconcileEmailFrom(alias.emailAddress.toUpperCase(), [primary, alias]),
    alias.emailAddress,
  );
  assert.deepEqual(
    { ...draft, fromAddress: reconcileEmailFrom(draft.fromAddress, [primary]) },
    { ...draft, fromAddress: primary.emailAddress },
  );
  assert.equal(reconcileEmailFrom(primary.emailAddress, []), '');
  assert.equal(reconcileEmailFrom('requested@example.test', [primary]), primary.emailAddress);
});

for (const phase of [
  'pending',
  'fenced',
  'applying',
  'uncertain',
  'rejected',
  'native_applied',
  'projected',
] as const) {
  test(`${phase} is not completed, does not allow sending or a conflicting mutation`, () => {
    const state = { ...observed(), change: change(phase) };
    assert.equal(isAddressChangeTerminal(state.change), false);
    assert.equal(addressControlsBlocked(state), true);
    assert.equal(emailSendAllowed(state, primary.emailAddress, [primary]), false);
    assert.equal(emailFromCanReconcile(state), false);
    assert.doesNotMatch(addressChangeLabel(state.change), /completed|ready/i);
    assert.equal(
      readAddressMutation(202, { change: state.change }, request, agentId, false).kind,
      'async',
    );
    assert.throws(() => readAddressMutation(200, { change: state.change }, request, agentId, true));
  });
}

test('completed and cancelled free mutation controls only after fresh observation; mail readiness is separate', () => {
  for (const phase of ['completed', 'cancelled'] as const) {
    const state = {
      ...observed(),
      observed: false,
      request,
      outcome: 'accepted' as const,
      change: change(phase),
    };
    assert.equal(addressControlsBlocked(state), true);
    const refreshed = observeEmailAddresses(
      state,
      {
        inbox,
        addresses: [primary],
        addressChange: change(phase),
        mailStatus: { state: 'unchecked' },
      },
      agentId,
      false,
    ).state;
    assert.equal(refreshed.request, null);
    assert.equal(addressControlsBlocked(refreshed), false);
    assert.equal(emailSendAllowed(refreshed, primary.emailAddress, [primary]), false);
  }
  assert.equal(
    readAddressMutation(200, { change: change('completed') }, request, agentId, false).kind,
    'async',
  );
  assert.throws(() =>
    readAddressMutation(202, { change: change('completed') }, request, agentId, true),
  );
});

test('projected SQL addresses do not authorize replacing the draft From before terminal readiness', () => {
  const renamed = { ...primary, emailAddress: 'new@example.test' };
  let state = observeEmailAddresses(
    observed(),
    {
      inbox: { ...inbox, emailAddress: renamed.emailAddress },
      addresses: [renamed],
      addressChange: change('projected'),
      mailStatus: ready,
    },
    agentId,
    true,
  ).state;
  assert.equal(emailFromCanReconcile(state), false);
  state = observeEmailAddresses(
    state,
    {
      inbox,
      addresses: [renamed],
      addressChange: change('completed'),
      mailStatus: { state: 'unchecked' },
    },
    agentId,
    false,
  ).state;
  assert.equal(emailFromCanReconcile(state), false);
  state = observeEmailAddresses(
    state,
    { inbox, addresses: [renamed], addressChange: change('completed'), mailStatus: ready },
    agentId,
    true,
  ).state;
  assert.equal(emailFromCanReconcile(state), true);
  assert.equal(
    reconcileEmailFrom(primary.emailAddress, activeEmailAddresses(state.addresses, inbox)),
    renamed.emailAddress,
  );
});

test('unknown request stays unresolved on an empty observation; explicit retry reuses its exact UUID and body', () => {
  const unknown = { ...observed(), request, outcome: 'unknown' as const };
  const refreshed = observeEmailAddresses(
    unknown,
    { inbox, addresses: [primary], addressChange: null, mailStatus: ready },
    agentId,
    true,
  ).state;
  assert.equal(refreshed.outcome, 'unknown');
  assert.equal(refreshed.request, request);
  assert.equal(emailSendAllowed(refreshed, primary.emailAddress, [primary]), false);
  const retry = addressMutationRequest(agentId, refreshed.request!);
  assert.equal(retry.init.headers['Idempotency-Key'], requestId);
  assert.deepEqual(retry, addressMutationRequest(agentId, request));
  const acknowledged = observeEmailAddresses(
    refreshed,
    { inbox, addressChange: change('pending'), mailStatus: ready },
    agentId,
    true,
  ).state;
  assert.equal(acknowledged.outcome, 'accepted');
  assert.equal(addressControlsBlocked(acknowledged), true);
});

test('unchecked, sync=false, missing follow-up status and failed reads cannot reuse a ready verdict', () => {
  for (const value of [{ state: 'unchecked' }, ready, undefined]) {
    const state = observeEmailAddresses(
      observed(),
      { inbox, mailStatus: value },
      agentId,
      false,
    ).state;
    assert.equal(emailSendAllowed(state, primary.emailAddress, [primary]), false);
  }
  assert.equal(
    emailSendAllowed(invalidateEmailObservation(observed()), primary.emailAddress, [primary]),
    false,
  );
  assert.equal(emailSendAllowed(observed(), primary.emailAddress, [primary]), true);
  assert.equal(emailSendAllowed(observed(), 'deleted@example.test', [primary]), false);
});

test('legacy observations retain provider-managed sending without claiming service readiness', () => {
  const state = observeEmailAddresses(
    initialEmailAddressState(),
    { inbox, mailStatus: { state: 'provider-managed' } },
    agentId,
    false,
  ).state;
  assert.equal(
    emailSendAllowed(state, primary.emailAddress, activeEmailAddresses(state.addresses, inbox)),
    true,
  );
});

test('responses must bind status, UUID, action, target and owner; errors never become success', () => {
  for (const bad of [
    { ...change('pending'), requestId: agentId },
    { ...change('pending'), action: 'alias-delete' },
    { ...change('pending'), target: 'foreign@example.test' },
    { ...change('pending'), phase: 'ready' },
    { ...change('pending'), internalError: 'PRIVATE_PROVIDER_ERROR' },
  ])
    assert.throws(() => readAddressMutation(202, { change: bad }, request, agentId, true));
  assert.throws(() => observeEmailAddresses(observed(), {}, agentId, false));
  assert.throws(() =>
    observeEmailAddresses(
      observed(),
      { inbox, addresses: [{ ...primary, agentId: requestId }] },
      agentId,
      false,
    ),
  );
  assert.throws(() =>
    observeEmailAddresses(
      { ...observed(), request },
      { inbox, addressChange: { ...change('pending'), target: 'wrong@example.test' } },
      agentId,
      false,
    ),
  );
  assert.throws(() =>
    readAddressMutation(
      503,
      { address: alias, addresses: [primary, alias] },
      request,
      agentId,
      true,
    ),
  );
});

test('legacy create, delete and rename accept only confirmed authoritative address outcomes', () => {
  const created = { address: alias, addresses: [primary, alias] };
  assert.equal(readAddressMutation(201, created, request, agentId, true).kind, 'legacy');
  assert.throws(() => readAddressMutation(201, created, request, agentId, false));
  assert.throws(() =>
    readAddressMutation(201, { ...created, addresses: [primary] }, request, agentId, true),
  );
  const deletion = { ...request, action: 'alias-delete' as const };
  assert.equal(
    readAddressMutation(200, { deleted: true, addresses: [] }, deletion, agentId, true).kind,
    'legacy',
  );
  assert.throws(() =>
    readAddressMutation(200, { deleted: true, addresses: [alias] }, deletion, agentId, true),
  );
  const rename = { ...request, action: 'primary-rename' as const, target: 'new@example.test' };
  assert.equal(
    readAddressMutation(
      200,
      {
        inbox: { ...inbox, emailAddress: rename.target },
        addresses: [{ ...primary, emailAddress: rename.target }],
        message: 'Updated',
      },
      rename,
      agentId,
      true,
    ).kind,
    'legacy',
  );
});

test('DELETE and primary rename carry the same explicit retry identity', () => {
  const deletion = addressMutationRequest(agentId, { ...request, action: 'alias-delete' });
  assert.equal(deletion.init.method, 'DELETE');
  assert.equal(
    new URL(deletion.url, 'https://example.test').searchParams.get('emailAddress'),
    alias.emailAddress,
  );
  assert.equal(deletion.init.headers['Idempotency-Key'], requestId);
  const rename = addressMutationRequest(agentId, { ...request, action: 'primary-rename' });
  assert.deepEqual(JSON.parse(rename.init.body!), { username: 'billing', confirmReplace: true });
  assert.throws(() => addressMutationRequest(agentId, { ...request, requestId: 'not-a-uuid' }));
});

test('unavailable address status preserves the inbox observation while blocking writes and Send', () => {
  const observation = observeEmailAddresses(
    observed(),
    {
      inbox,
      addresses: [primary, alias],
      addressChange: { phase: 'unavailable' },
      mailStatus: ready,
      messages: [{ id: 'preserved' }],
    },
    agentId,
    true,
  );
  assert.deepEqual(observation.value.inbox, inbox);
  assert.deepEqual(observation.state.addresses, [primary, alias]);
  assert.equal(observation.state.observed, true);
  assert.equal(observation.state.changeUnavailable, true);
  assert.equal(addressControlsBlocked(observation.state), true);
  assert.equal(emailFromCanReconcile(observation.state), false);
  assert.equal(emailSendAllowed(observation.state, primary.emailAddress, [primary]), false);
  const missing = observeEmailAddresses(
    observation.state,
    { inbox, mailStatus: ready },
    agentId,
    true,
  ).state;
  assert.equal(missing.changeUnavailable, true);
  const known = observeEmailAddresses(
    missing,
    { inbox, addressChange: null, mailStatus: ready },
    agentId,
    true,
  ).state;
  assert.equal(known.changeUnavailable, false);
  assert.equal(emailSendAllowed(known, primary.emailAddress, [primary]), true);
  assert.throws(() =>
    readAddressMutation(202, { change: { phase: 'unavailable' } }, request, agentId, true),
  );
});
