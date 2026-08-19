import assert from 'node:assert/strict';
import test from 'node:test';

import { handleInteraction } from '../src/handler.ts';
import { env, signed } from './helpers.ts';

const APPLICATION_COMMAND = 2;
const MESSAGE_COMMAND = 3;
const RESPONSE_DEFERRED = 5;
const RESPONSE_MESSAGE = 4;

function rightClick(content: string, attachments: unknown[] = []) {
  return {
    type: APPLICATION_COMMAND,
    application_id: '1',
    token: 'tok',
    guild_id: 'g',
    channel_id: 'c',
    member: { user: { username: 'anun' } },
    data: {
      name: 'Buat Issue',
      type: MESSAGE_COMMAND,
      target_id: 'm1',
      resolved: {
        messages: {
          m1: { id: 'm1', content, attachments, author: { username: 'rifa' } },
        },
      },
    },
  };
}

async function call(payload: unknown) {
  const deferred: Promise<unknown>[] = [];
  const res = await handleInteraction(signed(payload), env, (p) => deferred.push(p));
  return { body: (await res.json()) as any, deferred };
}

test('right-clicking a message defers and schedules the work', async () => {
  const { body, deferred } = await call(rightClick('checkout ketutup navbar di halaman produk'));
  assert.equal(body.type, RESPONSE_DEFERRED);
  assert.equal(body.data.flags, 64);
  assert.equal(deferred.length, 1);
});

test('a message with only an image is refused, not turned into a blank issue', async () => {
  // Without text there is nothing to title the task with.
  const { body, deferred } = await call(
    rightClick('', [{ id: 'a', filename: 'shot.png', size: 1, url: 'u', proxy_url: 'p' }]),
  );
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.match(body.data.content, /tidak punya cukup teks/);
  assert.equal(deferred.length, 0);
});

test('a missing target message is handled instead of crashing', async () => {
  const payload = rightClick('cukup panjang untuk lolos');
  payload.data.resolved.messages = {} as any;
  const { body, deferred } = await call(payload);
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.equal(deferred.length, 0);
});
