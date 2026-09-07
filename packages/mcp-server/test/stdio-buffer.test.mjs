import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js';

const inputLimit = 10 * 1024 * 1024;

async function fixture(t) {
  const input = new PassThrough();
  const output = new PassThrough();
  const received = [];
  const errors = [];
  const transport = new StdioServerTransport(input, output);
  let closes = 0;
  transport.onmessage = (message) => received.push(message);
  transport.onerror = (error) => errors.push(error);
  transport.onclose = () => closes++;
  await transport.start();
  t.after(async () => {
    await transport.close();
    input.destroy();
    output.destroy();
  });
  return { input, received, errors, closes: () => closes };
}

test('MCP startup retains the reviewed default 10 MiB input-buffer protection', async () => {
  assert.equal(STDIO_DEFAULT_MAX_BUFFER_SIZE, inputLimit);
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const transport = new StdioServerTransport\(\);/);
});

test('stdio accepts fragmented JSON-RPC frames and drains completed messages', async (t) => {
  const state = await fixture(t);
  const message = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const line = `${JSON.stringify(message)}\r\n`;
  state.input.write(line.slice(0, 12));
  assert.deepEqual(state.received, []);
  state.input.write(line.slice(12));
  state.input.write(`${JSON.stringify({ ...message, id: 2 })}\n`);
  assert.deepEqual(state.received, [message, { ...message, id: 2 }]);
  assert.deepEqual(state.errors, []);
  assert.equal(state.closes(), 0);
});

test('stdio accepts a complete frame at the byte ceiling and releases its buffer', async (t) => {
  const state = await fixture(t);
  const message = { jsonrpc: '2.0', id: 1, method: 'fixture', params: { text: '' } };
  const framingBytes = Buffer.byteLength(`${JSON.stringify(message)}\n`);
  message.params.text = 'a'.repeat(inputLimit - framingBytes);
  const line = Buffer.from(`${JSON.stringify(message)}\n`);
  assert.equal(line.byteLength, inputLimit);
  state.input.write(line.subarray(0, 4096));
  state.input.write(line.subarray(4096));
  state.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
  assert.equal(state.received.length, 2);
  assert.equal(state.received[0].params.text.length, inputLimit - framingBytes);
  assert.equal(state.received[1].id, 2);
  assert.deepEqual(state.errors, []);
  assert.equal(state.closes(), 0);
});

test('an oversized unfinished frame closes input without dispatching a request', async (t) => {
  const state = await fixture(t);
  state.input.write(Buffer.alloc(inputLimit, 97));
  assert.equal(state.errors.length, 0);
  state.input.write(Buffer.from('a'));
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0].message, /ReadBuffer exceeded maximum size of 10485760 bytes/);
  assert.equal(state.closes(), 1);
  assert.equal(state.input.listenerCount('data'), 0);
  state.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  assert.deepEqual(state.received, []);
});
