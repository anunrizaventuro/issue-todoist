import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';

import { CONFIG } from '../src/config.ts';
import { handleInteraction } from '../src/handler.ts';
import { findValue } from '../src/interaction.ts';
import { ROUTING_LABEL } from '../src/todoist.ts';
import { captureFetch, env, GUILD, memoryDrafts, signed } from './helpers.ts';

let outbound: ReturnType<typeof captureFetch>;
before(() => { outbound = captureFetch(); });
beforeEach(() => { outbound.sent.length = 0; });
after(() => outbound.restore());

const MODAL_SUBMIT = 5;
const RESPONSE_DEFERRED = 5;
const RESPONSE_MESSAGE = 4;

/** Modal payload as Discord nests it: Label wrapping the real input. */
function submission(
  text: string,
  extra: Record<string, unknown> = {},
  title = 'Checkout ketutup navbar',
) {
  return {
    type: MODAL_SUBMIT,
    guild_id: GUILD,
    channel_id: 'c-tak-terpetakan',
    application_id: '1',
    token: 'tok',
    data: {
      custom_id: 'issue:issue',
      components: [
        // The title is the only mandatory field, so every valid submission has one.
        { type: 18, component: { type: 4, custom_id: 'title', value: title } },
        { type: 18, component: { type: 4, custom_id: 'raw_input', value: text } },
      ],
      ...extra,
    },
  };
}

async function call(payload: unknown, override: any = env) {
  const deferred: Promise<unknown>[] = [];
  const res = await handleInteraction(signed(payload), override, (p) => deferred.push(p));
  return { res, body: (await res.json()) as any, deferred };
}

/**
 * A submission that reaches a working draft store.
 *
 * The shared `env` deliberately has none, which exercises the fallback; these
 * helpers cover the path an actual reporter takes.
 */
async function submitToDraft(payload: unknown) {
  const drafts = memoryDrafts();
  const { deferred } = await call(payload, { ...env, DRAFTS: drafts.binding });
  await Promise.all(deferred);
  return drafts.started[0]!;
}

test('a valid submission defers instead of replying inline', async () => {
  const { body, deferred } = await call(submission('tombol checkout ketutup navbar di mobile'));
  assert.equal(body.type, RESPONSE_DEFERRED, 'must ACK within 3 seconds, not do work first');
  assert.equal(body.data.flags, 64, 'reply must be ephemeral');
  assert.equal(deferred.length, 1, 'the real work must be scheduled via waitUntil');
});

test('a too-short title is rejected without scheduling any work', async () => {
  // The title is the last thing standing between an empty form and a task
  // nobody can act on, now that everything else is optional.
  const { body, deferred } = await call(submission('kodepos kosong', {}, 'eh'));
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.match(body.data.content, /terlalu pendek/);
  assert.equal(deferred.length, 0, 'must not spend an API call on a rejected issue');
});

test('a title with no description at all is accepted', async () => {
  const draft = await submitToDraft(submission('', {}, 'Kodepos tidak terisi otomatis'));
  assert.equal(draft.issue.title, 'Kodepos tidak terisi otomatis');
  assert.equal(draft.status, 'pending');
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

const filedTask = () => outbound.sent.find((r) => r.url.includes('todoist'))!.body;

test('the URL typed into the form reaches the draft', async () => {
  const payload = submission('tombol checkout ketutup navbar di mobile');
  payload.data.components.push({
    type: 18,
    component: { type: 4, custom_id: 'page_url', value: 'https://toko.example.com/keranjang' },
  });

  const draft = await submitToDraft(payload);
  assert.equal(draft.issue.url, 'https://toko.example.com/keranjang');
});

test('leaving the URL field blank leaves the draft without one', async () => {
  const draft = await submitToDraft(submission('tombol checkout ketutup navbar di mobile'));
  assert.equal(draft.issue.url, null);
});

test('a submission is parked for review rather than filed straight away', async () => {
  const drafts = memoryDrafts();
  const { deferred } = await call(
    submission('tombol checkout ketutup navbar di mobile'),
    { ...env, DRAFTS: drafts.binding },
  );
  await Promise.all(deferred);

  assert.equal(drafts.started.length, 1);
  assert.equal(drafts.started[0].status, 'pending');
  assert.ok(
    !outbound.sent.some((r) => r.url.includes('todoist')),
    'nothing may reach Todoist before the reporter approves',
  );

  const card = outbound.sent.find((r) => r.url.includes('discord'))!.body;
  assert.match(JSON.stringify(card), /Approve/);
  assert.match(JSON.stringify(card), /Otomatis masuk/);
});

test('with no draft store reachable the report is filed the old way', async () => {
  // A feature meant to raise quality must never be the reason a report is lost.
  const { deferred } = await call(submission('tombol checkout ketutup navbar di mobile'), {
    ...env,
    DRAFTS: { idFromName: () => ({}), get: () => { throw new Error('down'); } },
  });
  await Promise.all(deferred);

  assert.ok(filedTask(), 'the issue must still reach Todoist');
});

async function fileFromUnmappedChannel(): Promise<void> {
  const { deferred } = await call(submission('tombol checkout ketutup navbar di mobile'), {
    ...env,
    DRAFTS: { idFromName: () => ({}), get: () => { throw new Error('down'); } },
  });
  await Promise.all(deferred);
}

test('a report from an unmapped channel lands in the default project', async () => {
  // The destination lives in one file; nothing downstream may hold its own copy.
  await fileFromUnmappedChannel();
  assert.equal(filedTask().project_id, CONFIG.todoist.defaultProjectId);
});

test('while the channel map is empty no task is labelled for routing', async () => {
  // The default is the intended destination until real pairs exist, so the
  // label must stay meaningful rather than land on every single task.
  await fileFromUnmappedChannel();
  assert.ok(
    !filedTask().labels.includes(ROUTING_LABEL),
    `labels were ${JSON.stringify(filedTask().labels)}`,
  );
});

test('the channel the report came from reaches the draft', async () => {
  // Without this the map is consulted with an empty channel and every report
  // silently takes the default, however carefully the map is filled in.
  const draft = await submitToDraft(submission('tombol checkout ketutup navbar di mobile'));
  assert.equal(draft.context.channelId, 'c-tak-terpetakan');
});

test('the why field reaches the draft verbatim', async () => {
  const payload = submission('kodepos kosong terus');
  payload.data.components.push({
    type: 18,
    component: { type: 4, custom_id: 'why', value: 'pelanggan batal checkout' },
  });

  const draft = await submitToDraft(payload);
  assert.equal(draft.issue.why, 'pelanggan batal checkout', 'the model must not rewrite it');
});

test('the title typed into the form beats the one the model would pick', async () => {
  const draft = await submitToDraft(
    submission('tombol checkout ketutup navbar di mobile', {}, 'Navbar menutupi tombol checkout'),
  );
  assert.equal(draft.issue.title, 'Navbar menutupi tombol checkout');
});

test('a title longer than Todoist keeps is clipped, not dropped', async () => {
  const draft = await submitToDraft(
    submission('tombol checkout ketutup navbar di mobile', {}, 'x'.repeat(150)),
  );
  assert.ok(draft.issue.title.length <= 100, `got ${draft.issue.title.length}`);
});


