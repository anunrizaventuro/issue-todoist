import assert from 'node:assert/strict';
import test from 'node:test';

import { handleInteraction } from '../src/handler.ts';
import type { Draft } from '../src/draft.ts';
import { fromRawInput } from '../src/issue.ts';
import { captureFetch, env as baseEnv, memoryDrafts, signed } from './helpers.ts';

const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
const RESPONSE_MESSAGE = 4;
const RESPONSE_DEFERRED_UPDATE = 6;
const RESPONSE_UPDATE = 7;
const RESPONSE_MODAL = 9;
const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function pending(overrides: Partial<Draft> = {}): Draft {
  return {
    id: ID,
    status: 'pending',
    issue: { ...fromRawInput('kodepos tidak terisi otomatis'), title: 'Kodepos kosong' },
    context: {
      command: 'issue',
      rawInput: 'kodepos tidak terisi otomatis',
      author: 'rifa',
      filedBy: null,
      sourceLink: null,
      typedTitle: null,
      pageUrl: null,
      attachments: [],
      normalized: true,
    },
    reporterId: '123',
    applicationId: '1',
    token: 'tok',
    taskUrl: null,
    ...overrides,
  };
}

/** An env whose draft store already holds `draft`. */
function withDraft(draft: Draft | null) {
  const drafts = memoryDrafts();
  drafts.set(draft);
  return { drafts, env: { ...baseEnv, DRAFTS: drafts.binding } as any };
}

function click(action: string, extra: Record<string, unknown> = {}) {
  return {
    type: MESSAGE_COMPONENT,
    application_id: '1',
    token: 'tok2',
    guild_id: '1392070580534251621',
    member: { user: { id: '123', username: 'rifa' } },
    data: { custom_id: `d:${action}:${ID}`, ...extra },
  };
}

function modalSubmit(action: string, components: unknown[]) {
  return {
    type: MODAL_SUBMIT,
    application_id: '1',
    token: 'tok2',
    guild_id: '1392070580534251621',
    member: { user: { id: '123', username: 'rifa' } },
    data: { custom_id: `dm:${action}:${ID}`, components },
  };
}

const label = (customId: string, value: string) => ({
  type: 18,
  component: { type: 4, custom_id: customId, value },
});

async function call(payload: unknown, env: any) {
  const deferred: Promise<unknown>[] = [];
  const res = await handleInteraction(signed(payload), env, (p) => deferred.push(p));
  return { res, body: (await res.json()) as any, deferred };
}

test('Approve acknowledges fast and files in the background', async () => {
  const outbound = captureFetch();
  try {
    const { env } = withDraft(pending());
    const { body, deferred } = await call(click('ok'), env);

    // Todoist is far too slow for Discord's 3-second budget.
    assert.equal(body.type, RESPONSE_DEFERRED_UPDATE);
    await Promise.all(deferred);
    assert.ok(outbound.sent.some((r) => r.url.includes('discord')), 'the card must be replaced');
  } finally {
    outbound.restore();
  }
});

test('Edit opens a modal prefilled from the draft', async () => {
  const { env } = withDraft(pending());
  const { body } = await call(click('edit'), env);

  assert.equal(body.type, RESPONSE_MODAL);
  assert.equal(body.data.custom_id, `dm:edit:${ID}`);
  const ids = body.data.components.map((c: any) => c.component.custom_id);
  assert.deepEqual(ids, ['title', 'page_url', 'raw_input', 'expected', 'action']);
  assert.ok(body.data.components.length <= 5, 'Discord caps a modal at 5 components');
  assert.equal(body.data.components[0].component.value, 'Kodepos kosong');
});

test('Tulis ulang opens a modal holding the original text', async () => {
  const { env } = withDraft(pending());
  const { body } = await call(click('rw'), env);

  assert.equal(body.type, RESPONSE_MODAL);
  assert.equal(body.data.custom_id, `dm:rw:${ID}`);
  assert.match(JSON.stringify(body.data.components), /kodepos tidak terisi otomatis/);
});

test('submitting the edit updates the card inline, without calling the model', async () => {
  const outbound = captureFetch();
  try {
    const { env } = withDraft(pending());
    const { body } = await call(
      modalSubmit('edit', [
        label('title', 'Kodepos tidak terisi otomatis'),
        label('page_url', 'https://app.example.com/checkout'),
        label('raw_input', 'kodepos kosong terus'),
        label('expected', 'terisi dari kelurahan'),
        label('action', ''),
      ]),
      env,
    );

    assert.equal(body.type, RESPONSE_UPDATE, 'no provider call, so no need to defer');
    assert.match(JSON.stringify(body.data), /Kodepos tidak terisi otomatis/);
    assert.equal(outbound.sent.length, 0, 'editing must not file anything');
  } finally {
    outbound.restore();
  }
});

test('the priority dropdown updates the card in place', async () => {
  const { drafts, env } = withDraft(pending());
  const { body } = await call(click('pr', { values: ['3'] }), env);

  assert.equal(body.type, RESPONSE_UPDATE);
  const select = body.data.components[1].components[0];
  assert.equal(select.options.find((o: any) => o.default).value, '3');
  assert.ok(drafts);
});

test('Batal hands the text back and files nothing', async () => {
  const outbound = captureFetch();
  try {
    const { env } = withDraft(pending());
    const { body } = await call(click('x'), env);

    assert.equal(body.type, RESPONSE_UPDATE);
    assert.match(JSON.stringify(body.data), /kodepos tidak terisi otomatis/);
    assert.equal(outbound.sent.length, 0, 'cancelling must never reach Todoist');
  } finally {
    outbound.restore();
  }
});

test('a click on a finished draft offers the task instead of acting', async () => {
  const { env } = withDraft(
    pending({ status: 'filed', taskUrl: 'https://app.todoist.com/app/task/9' }),
  );
  const { body } = await call(click('ok'), env);

  assert.equal(body.type, RESPONSE_UPDATE);
  assert.match(JSON.stringify(body.data), /sudah/);
  assert.match(JSON.stringify(body.data), /task\/9/);
});

test('someone who is not the reporter is refused', async () => {
  const { env } = withDraft(pending());
  const payload = click('ok');
  payload.member.user.id = '999';

  const { body } = await call(payload, env);
  assert.equal(body.type, RESPONSE_MESSAGE);
  assert.match(body.data.content, /bukan draft kamu/i);
});

test('a draft that no longer exists is refused without crashing', async () => {
  const { env } = withDraft(null);
  const { body } = await call(click('ok'), env);
  assert.match(JSON.stringify(body.data), /tidak ditemukan/i);
});

test('an unknown button custom_id is refused', async () => {
  const { env } = withDraft(pending());
  const payload = click('ok');
  payload.data.custom_id = 'nonsense';

  const { body } = await call(payload, env);
  assert.equal(body.type, RESPONSE_MESSAGE);
});

test('a draft button from another guild never reaches the draft store', async () => {
  const { env } = withDraft(pending());
  const payload = click('ok');
  payload.guild_id = '999';

  const { body } = await call(payload, { ...env, ALLOWED_GUILD_IDS: '1392070580534251621' });
  assert.match(body.data.content, /belum diaktifkan/i);
});
