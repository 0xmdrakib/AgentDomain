import assert from 'node:assert/strict';
import test from 'node:test';
import { publicOperations, publicSchemas } from '../scripts/public-api-contract.mjs';

// Public wire expectations, independently asserted instead of deriving expected values from the generator.
const expected = [
  ['get', '/api/v1', 'discoverApi', ['200'], 'public'],
  ['get', '/api/v1/agents/search', 'searchAgents', ['200'], 'public'],
  ['get', '/api/v1/agents/by-wallet/{wallet}', 'agentsByWallet', ['200'], 'owner'],
  ['get', '/api/v1/agents/{id}', 'getAgent', ['200'], 'agent'],
  ['get', '/api/v1/agents/quote', 'quoteRegistration', ['200'], 'public'],
  ['post', '/api/v1/agents/register', 'registerAgent', ['200', '202'], 'public'],
  ['get', '/api/v1/registrations/{registrationId}', 'getRegistration', ['200'], 'payer'],
  ['get', '/api/v1/registrations', 'listRegistrations', ['200'], 'payer'],
  ['get', '/api/v1/registration-notices', 'listRegistrationNotices', ['200'], 'payer'],
  ['put', '/api/v1/registration-notices', 'recordUnknownSubmissionNotice', ['200'], 'payer'],
  ['post', '/api/v1/registration-notices', 'associateRegistrationNotice', ['200'], 'payer'],
  [
    'delete',
    '/api/v1/registration-notices/{encodedNoticeId}',
    'dismissRegistrationNotice',
    ['204'],
    'payer',
  ],
  ['get', '/api/v1/agents/{id}/dns/capabilities', 'getDnsCapabilities', ['200'], 'agent'],
  ['get', '/api/v1/agents/{id}/dns', 'listDnsRecords', ['200'], 'agent'],
  ['post', '/api/v1/agents/{id}/dns', 'createDnsRecord', ['201'], 'agent'],
  ['patch', '/api/v1/agents/{id}/dns/{recordId}', 'updateDnsRecord', ['200'], 'agent'],
  ['delete', '/api/v1/agents/{id}/dns/{recordId}', 'deleteDnsRecord', ['200'], 'agent'],
  ['post', '/api/v1/agents/{id}/dns/batch', 'applyDnsBatch', ['200'], 'agent'],
  ['post', '/api/v1/agents/{id}/dns/import', 'importDnsZone', ['200'], 'agent'],
  ['get', '/api/v1/agents/{id}/dns/export', 'exportDnsZone', ['200'], 'agent'],
  ['get', '/api/v1/agents/{id}/email', 'listEmail', ['200'], 'agent'],
  ['delete', '/api/v1/agents/{id}/email/{messageId}', 'deleteEmail', ['200'], 'agent'],
  ['patch', '/api/v1/agents/{id}/email', 'replacePrimaryEmail', ['200', '202'], 'agent'],
  ['post', '/api/v1/agents/{id}/email/aliases', 'createEmailAlias', ['200', '201', '202'], 'agent'],
  ['delete', '/api/v1/agents/{id}/email/aliases', 'deleteEmailAlias', ['200', '202'], 'agent'],
  ['post', '/api/v1/agents/{id}/email/send', 'sendEmail', ['201', '202'], 'agent'],
  ['post', '/api/v1/agents/{id}/email/batch', 'sendEmailBatch', ['202'], 'agent'],
  ['get', '/api/v1/agents/{id}/email/usage', 'getEmailUsage', ['200'], 'agent'],
  ['get', '/api/v1/agents/{id}/email/webhook', 'getEmailWebhook', ['200'], 'agent'],
  ['put', '/api/v1/agents/{id}/email/webhook', 'configureEmailWebhook', ['200', '201'], 'agent'],
  [
    'patch',
    '/api/v1/agents/{id}/email/webhook',
    'rotateEmailWebhookSigningValue',
    ['200'],
    'agent',
  ],
  ['get', '/api/v1/agents/{id}/email/blocklist', 'listEmailBlocklist', ['200'], 'agent'],
  ['post', '/api/v1/agents/{id}/email/blocklist', 'addEmailBlocklistEntry', ['201'], 'agent'],
  [
    'delete',
    '/api/v1/agents/{id}/email/blocklist/{blockId}',
    'deleteEmailBlocklistEntry',
    ['200'],
    'agent',
  ],
];

function assertMatrix(operations) {
  assert.equal(operations.length, 34);
  for (const [method, path, id, statuses, scope] of expected) {
    const entry = operations.find((entry) => entry.method === method && entry.path === path);
    assert.ok(entry, `${method} ${path}`);
    assert.equal(entry.operation.operationId, id);
    assert.deepEqual(
      Object.keys(entry.operation.responses)
        .filter((code) => /^2\d\d$/.test(code))
        .sort(),
      statuses,
      id,
    );
    assert.equal(entry.operation['x-auth-scope'], scope, id);
    const security =
      scope === 'public'
        ? []
        : scope === 'agent'
          ? [{ AgentApiKey: [] }, { WalletSignature: [] }]
          : [{ WalletSignature: [] }];
    assert.deepEqual(entry.operation.security, security, id);
  }
}

test('all 34 documented HTTP operations have exact reviewed success and authentication contracts', () => {
  assertMatrix(publicOperations());
});

test('asynchronous address acceptance cannot be confused with completed mutation', () => {
  const schemas = publicSchemas();
  const accepted = schemas.EmailAddressChangeAcceptedResponse.properties.change;
  const completed = schemas.EmailAddressChangeCompletedResponse.properties.change;
  assert.equal(accepted.properties.phase.enum.includes('completed'), false);
  assert.equal(accepted.properties.phase.enum.includes('projected'), true);
  assert.deepEqual(completed.properties.phase.enum, ['completed']);
  assert.ok(schemas.EmailListResponse.properties.addressChange);
  assert.ok(schemas.EmailListResponse.properties.mailStatus);
  for (const name of ['replacePrimaryEmail', 'createEmailAlias', 'deleteEmailAlias']) {
    const operation = publicOperations().find(
      (entry) => entry.operation.operationId === name,
    ).operation;
    assert.ok(
      operation.parameters.some(
        (value) =>
          value.in === 'header' &&
          value.name === 'Idempotency-Key' &&
          value.schema.format === 'uuid',
      ),
    );
  }
});

test('the regression matrix rejects the former universal 200 and public-wallet assumptions', () => {
  const statuses = structuredClone(publicOperations());
  const send = statuses.find((entry) => entry.operation.operationId === 'sendEmail').operation;
  send.responses['200'] = send.responses['201'];
  delete send.responses['201'];
  assert.throws(() => assertMatrix(statuses), /sendEmail/);
  const scope = structuredClone(publicOperations());
  scope.find((entry) => entry.operation.operationId === 'agentsByWallet').operation.security = [{}];
  assert.throws(() => assertMatrix(scope), /agentsByWallet/);
});

test('empty 204 and text/dns success responses are not passed to a JSON error decoder', () => {
  const operations = publicOperations();
  const dismiss = operations.find(
    (entry) => entry.operation.operationId === 'dismissRegistrationNotice',
  ).operation;
  assert.equal(dismiss.responses['204'].content, undefined);
  assert.ok(dismiss.responses['204'].headers['X-Authenticated-Wallet']);
  const dns = operations.find((entry) => entry.operation.operationId === 'exportDnsZone').operation;
  assert.deepEqual(Object.keys(dns.responses['200'].content), ['text/dns']);
  for (const { operation } of operations) {
    assert.equal(operation.responses.default, undefined);
    assert.equal(
      operation.responses['2XX'].content['application/json'].schema.$ref,
      '#/components/schemas/DocumentedJson',
    );
    assert.equal(
      operation.responses['4XX'].content['application/json'].schema.$ref,
      '#/components/schemas/PublicError',
    );
    assert.equal(
      operation.responses['5XX'].content['application/json'].schema.$ref,
      '#/components/schemas/PublicError',
    );
  }
});

test('normal and partially accepted email envelopes keep their different required fields', () => {
  const schemas = publicSchemas();
  assert.deepEqual(schemas.EmailQueuedResponse.required, ['id', 'status', 'messages']);
  assert.deepEqual(schemas.EmailPartialResponse.required, [
    'id',
    'status',
    'code',
    'messages',
    'usage',
  ]);
  assert.deepEqual(schemas.EmailBatchQueuedResponse.required, [
    'batchId',
    'status',
    'jobs',
    'errors',
  ]);
  assert.deepEqual(schemas.EmailBatchPartialResponse.required, [
    'code',
    'message',
    'jobs',
    'usage',
  ]);
  assert.equal(schemas.EmailBatchPartialResponse.required.includes('batchId'), false);
  assert.equal(schemas.EmailBatchPartialResponse.required.includes('status'), false);
  assert.equal(schemas.EmailBatchPartialResponse.required.includes('errors'), false);
  assert.deepEqual(schemas.EmailBatchResponse.anyOf, [
    { $ref: '#/components/schemas/EmailBatchQueuedResponse' },
    { $ref: '#/components/schemas/EmailBatchPartialResponse' },
  ]);
});

test('webhook creation and rotation require sensitive signing output while reads and updates do not', () => {
  const schemas = publicSchemas();
  assert.deepEqual(schemas.WebhookCreatedResponse.required, ['webhook', 'signingSecret']);
  assert.equal(schemas.WebhookCreatedResponse.properties.signingSecret['x-sensitive'], true);
  assert.deepEqual(schemas.WebhookUpdatedResponse.required, ['webhook']);
  assert.equal(schemas.WebhookReadResponse.properties.webhook.nullable, true);
  const operations = publicOperations();
  const configure = operations.find(
    (entry) => entry.operation.operationId === 'configureEmailWebhook',
  ).operation.responses;
  assert.equal(
    configure['200'].content['application/json'].schema.$ref,
    '#/components/schemas/WebhookUpdatedResponse',
  );
  assert.equal(
    configure['201'].content['application/json'].schema.$ref,
    '#/components/schemas/WebhookCreatedResponse',
  );
});

test('code-only and legacy error envelopes remain valid public shapes with optional messages', () => {
  const schema = publicSchemas().PublicError;
  assert.equal(schema.required, undefined);
  assert.deepEqual(schema.anyOf, [{ required: ['code'] }, { required: ['error'] }]);
  assert.ok(schema.properties.code);
  assert.ok(schema.properties.error);
  assert.ok(schema.properties.message);
});

test('quote defaults and recovery handles do not invent required fields or exclude refunded status', () => {
  const quote = publicOperations().find(
    (entry) => entry.operation.operationId === 'quoteRegistration',
  ).operation;
  assert.deepEqual(
    quote.parameters.filter((item) => item.required).map((item) => item.name),
    ['preferredName'],
  );
  assert.equal(quote.parameters.find((item) => item.name === 'tld').schema.default, 'xyz');
  const schema = publicSchemas().RegistrationHandleResponse;
  assert.ok(schema.properties.status.enum.includes('refunded'));
  assert.deepEqual(schema.required, ['registrationId', 'status']);
});
