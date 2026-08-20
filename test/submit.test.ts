import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';

import { buildIssueModal } from '../src/discord.ts';
import { handleInteraction } from '../src/handler.ts';
import { findValue } from '../src/interaction.ts';
import { captureFetch, env, memoryDrafts, signed } from './helpers.ts';

let outbound: ReturnType<typeof captureFetch>;
before(() => { outbound = captureFetch(); });
beforeEach(() => { outbound.sent.length = 0; });
after(() => outbound.restore());

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

test('the modal asks for title, url, description and images in that order', () => {
  const modal = buildIssueModal('issue');
  const ids = modal.data.components.map((c: any) => c.component.custom_id);
  assert.deepEqual(ids, ['title', 'page_url', 'raw_input', 'attachments']);
});

test('the title typed into the form beats the one the model would pick', async () => {
  const payload = submission('tombol checkout ketutup navbar di mobile');
  payload.data.components.push({
    type: 18,
    component: { type: 4, custom_id: 'title', value: 'Navbar menutupi tombol checkout' },
  });

  const draft = await submitToDraft(payload);
  assert.equal(draft.issue.title, 'Navbar menutupi tombol checkout');
});

test('a title longer than Todoist keeps is clipped, not dropped', async () => {
  const payload = submission('tombol checkout ketutup navbar di mobile');
  payload.data.components.push({
    type: 18,
    component: { type: 4, custom_id: 'title', value: 'x'.repeat(150) },
  });

  const draft = await submitToDraft(payload);
  assert.ok(draft.issue.title.length <= 100, `got ${draft.issue.title.length}`);
});

test('without a title field the model keeps deciding, as the right-click path needs', async () => {
  const draft = await submitToDraft(submission('tombol checkout ketutup navbar di mobile'));
  assert.equal(draft.issue.title, 'tombol checkout ketutup navbar di mobile');
});
