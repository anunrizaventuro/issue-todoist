import assert from 'node:assert/strict';
import test from 'node:test';

import { handleInteraction } from '../src/handler.ts';
import { findValue } from '../src/interaction.ts';
import { env, signed } from './helpers.ts';

const MODAL_SUBMIT = 5;
const RESPONSE_DEFERRED = 5;
const RESPONSE_MESSAGE = 4;

/** Modal payload as Discord nests it: Label wrapping the real input. */
function submission(text: string, extra: Record<string, unknown> = {}) {
  return {
    type: MODAL_SUBMIT,
    application_id: '1',
    token: 'tok',
    data: {
      custom_id: 'issue:issue',
      components: [
        { type: 18, component: { type: 4, custom_id: 'raw_input', value: text } },
      ],
      ...extra,
    },
  };
}

async function call(payload: unknown) {
  const deferred: Promise<unknown>[] = [];
  const res = await handleInteraction(signed(payload), env, (p) => deferred.push(p));
  return { res, body: (await res.json()) as any, deferred };
}

test('a valid submission defers instead of replying inline', async () => {
  const { body, deferred } = await call(submission('tombol checkout ketutup navbar di mobile'));
  assert.equal(body.type, RESPONSE_DEFERRED, 'must ACK within 3 seconds, not do work first');
  assert.equal(body.data.flags, 64, 'reply must be ephemeral');
  assert.equal(deferred.length, 1, 'the real work must be scheduled via waitUntil');
});

test('a too-short issue is rejected without scheduling any work', async () => {
  const { body, deferred } = await call(submission('error'));
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.match(body.data.content, /terlalu pendek/);
  assert.equal(deferred.length, 0, 'must not spend an API call on a rejected issue');
});

test('an unknown modal custom_id is rejected', async () => {
  const payload = submission('cukup panjang untuk lolos');
  payload.data.custom_id = 'issue:nope';
  const { body, deferred } = await call(payload);
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.equal(deferred.length, 0);
});

test('findValue reaches inputs regardless of nesting depth', () => {
  // Guards against Discord changing how modals nest components.
  assert.equal(findValue([{ type: 4, custom_id: 'x', value: 'flat' }], 'x'), 'flat');
  assert.equal(
    findValue([{ type: 18, component: { type: 4, custom_id: 'x', value: 'label' } }], 'x'),
    'label',
  );
  assert.equal(
    findValue([{ type: 1, components: [{ type: 4, custom_id: 'x', value: 'row' }] }], 'x'),
    'row',
  );
  assert.equal(findValue([{ type: 4, custom_id: 'y', value: 'no' }], 'x'), undefined);
});
