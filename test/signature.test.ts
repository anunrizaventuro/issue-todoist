import assert from 'node:assert/strict';
import test from 'node:test';

import { handleInteraction } from '../src/handler.ts';
import { env, noopWaitUntil, request, signed } from './helpers.ts';

const call = (req: Request) => handleInteraction(req, env, noopWaitUntil);

test('valid PING signature returns PONG', async () => {
  const res = await call(signed({ type: 1 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { type: 1 });
});

test('tampered body is rejected with 401', async () => {
  const original = signed({ type: 1 });
  const forged = request(JSON.stringify({ type: 2 }), {
    'X-Signature-Ed25519': original.headers.get('X-Signature-Ed25519')!,
    'X-Signature-Timestamp': original.headers.get('X-Signature-Timestamp')!,
  });
  assert.equal((await call(forged)).status, 401);
});

test('garbage signature is rejected with 401', async () => {
  const req = request(JSON.stringify({ type: 1 }), {
    'X-Signature-Ed25519': 'ff'.repeat(64),
    'X-Signature-Timestamp': '1700000000',
  });
  assert.equal((await call(req)).status, 401);
});

test('missing signature headers are rejected with 401', async () => {
  assert.equal((await call(request(JSON.stringify({ type: 1 }), {}))).status, 401);
});

test('GET is rejected with 405', async () => {
  assert.equal((await call(new Request('https://example.com/'))).status, 405);
});
