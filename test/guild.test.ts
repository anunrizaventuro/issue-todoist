import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';

import { handleInteraction } from '../src/handler.ts';
import { isGuildAllowed } from '../src/interaction.ts';
import { captureFetch, env, noopWaitUntil, signed } from './helpers.ts';

const PING = 1;
const APPLICATION_COMMAND = 2;
const MODAL_SUBMIT = 5;
const MESSAGE_COMMAND = 3;
const RESPONSE_PONG = 1;
const RESPONSE_MESSAGE = 4;
const RESPONSE_MODAL = 9;

/** Only this guild may file issues. */
const guarded = { ...env, ALLOWED_GUILD_IDS: 'g1, g2' };

let outbound: ReturnType<typeof captureFetch>;
before(() => { outbound = captureFetch(); });
beforeEach(() => { outbound.sent.length = 0; });
after(() => outbound.restore());

async function call(payload: unknown, e = guarded) {
  const deferred: Promise<unknown>[] = [];
  const res = await handleInteraction(signed(payload), e, (p) => deferred.push(p));
  return { body: (await res.json()) as any, deferred };
}

const slash = (guildId?: string) => ({
  type: APPLICATION_COMMAND,
  ...(guildId ? { guild_id: guildId } : {}),
  data: { name: 'issue' },
});

test('a PING is answered even though it carries no guild', async () => {
  // Rejecting this un-registers the Interactions Endpoint URL in Discord.
  const { body } = await call({ type: PING });
  assert.equal(body.type, RESPONSE_PONG);
});

test('a command from a listed guild opens the modal as usual', async () => {
  const { body } = await call(slash('g1'));
  assert.equal(body.type, RESPONSE_MODAL);
});

test('a command from an unlisted guild is refused', async () => {
  const { body } = await call(slash('g9'));
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.equal(body.data.flags, 64, 'the refusal must be ephemeral');
});

test('a command with no guild at all is refused once a list is set', async () => {
  // Interactions in DMs carry no guild_id, so there is nothing to match.
  const { body } = await call(slash(undefined));
  assert.equal(body.type, RESPONSE_MESSAGE);
});

test('an empty allowlist still allows any guild', async () => {
  const { body } = await call(slash('anything'), env);
  assert.equal(body.type, RESPONSE_MODAL);
});

test('a modal submitted from an unlisted guild files nothing', async () => {
  // The gate has to cover the submit too: the modal id is guessable, so a
  // check that only guards the slash command guards nothing.
  const { body, deferred } = await call({
    type: MODAL_SUBMIT,
    guild_id: 'g9',
    application_id: '1',
    token: 'tok',
    data: {
      custom_id: 'issue:issue',
      components: [{ type: 18, component: { type: 4, custom_id: 'raw_input', value: 'cukup panjang untuk lolos' } }],
    },
  });

  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.equal(deferred.length, 0, 'no work may be scheduled for a refused guild');
  assert.equal(outbound.sent.length, 0, 'nothing may reach Todoist');
});

test('a right-click from an unlisted guild files nothing', async () => {
  const { body, deferred } = await call({
    type: APPLICATION_COMMAND,
    guild_id: 'g9',
    application_id: '1',
    token: 'tok',
    channel_id: 'c',
    data: {
      name: 'Buat Issue',
      type: MESSAGE_COMMAND,
      target_id: 'm1',
      resolved: { messages: { m1: { id: 'm1', content: 'checkout ketutup navbar', attachments: [] } } },
    },
  });

  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.equal(deferred.length, 0);
});

test('isGuildAllowed ignores blanks and spacing in the list', () => {
  assert.equal(isGuildAllowed(' g1 , , g2,', 'g2'), true);
  assert.equal(isGuildAllowed(' g1 , , g2,', 'g3'), false);
  assert.equal(isGuildAllowed('   ', 'anything'), true, 'blank means unrestricted');
  assert.equal(isGuildAllowed('g1', undefined), false);
});
