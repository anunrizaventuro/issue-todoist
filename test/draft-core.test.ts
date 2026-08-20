import assert from 'node:assert/strict';
import test from 'node:test';

import { DraftCore } from '../src/draft-core.ts';
import type { Draft } from '../src/draft.ts';
import { fromRawInput } from '../src/issue.ts';
import { captureFetch, env, fakeState } from './helpers.ts';

const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';
const WINDOW = 10 * 60_000;

function newDraft(): Draft {
  return {
    id: ID,
    status: 'pending',
    issue: fromRawInput('kodepos tidak terisi otomatis'),
    context: {
      command: 'issue',
      rawInput: 'kodepos tidak terisi otomatis',
      author: 'rifa',
      authorUsername: null,
      filedBy: null,
      filedByUsername: null,
      sourceLink: null,
      typedTitle: null,
      why: null,
      pageUrl: null,
      attachments: [],
      normalized: true,
    },
    reporterId: '123',
    applicationId: '1',
    token: 'tok',
    taskUrl: null,
  };
}

function core() {
  const state = fakeState();
  return { state, obj: new DraftCore(state.storage, env) };
}

const todoistCalls = (o: ReturnType<typeof captureFetch>) =>
  o.sent.filter((r) => r.url.includes('todoist') && !r.body?.parent_id).length;

test('starting a draft arms the alarm', async () => {
  const { state, obj } = core();
  await obj.start(newDraft(), WINDOW);

  assert.ok(state.alarmAt()! > Date.now(), 'alarm must be in the future');
  assert.equal((await obj.read())!.status, 'pending');
});

test('approving files once and disarms the alarm', async () => {
  const outbound = captureFetch();
  try {
    const { state, obj } = core();
    await obj.start(newDraft(), WINDOW);

    const first = await obj.approve();
    assert.notEqual(first, 'closed');
    assert.equal(todoistCalls(outbound), 1);
    assert.equal(state.alarmAt(), null, 'a filed draft must not fire later');

    // The second click is the race this whole object exists to prevent.
    assert.equal(await obj.approve(), 'closed');
    assert.equal(todoistCalls(outbound), 1, 'must not file twice');
  } finally {
    outbound.restore();
  }
});

test('approving remembers the task, so a late click can still link to it', async () => {
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);
    await obj.approve();

    const draft = (await obj.read())!;
    assert.equal(draft.status, 'filed');
    assert.match(draft.taskUrl!, /todoist\.com/);
  } finally {
    outbound.restore();
  }
});

test('the alarm files an abandoned draft with needs-review', async () => {
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);
    await obj.fire();

    const filed = outbound.sent.find((r) => r.url.includes('todoist'))!;
    assert.ok(filed.body.labels.includes('needs-review'));
    assert.equal((await obj.read())!.status, 'filed');
    assert.ok(
      outbound.sent.some((r) => r.url.includes('discord')),
      'the draft message must be updated, not left showing dead buttons',
    );
  } finally {
    outbound.restore();
  }
});

test('the alarm does nothing to a draft that was already approved', async () => {
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);
    await obj.approve();
    const before = outbound.sent.length;

    await obj.fire();
    assert.equal(outbound.sent.length, before);
  } finally {
    outbound.restore();
  }
});

test('cancelling stops the alarm and files nothing', async () => {
  const outbound = captureFetch();
  try {
    const { state, obj } = core();
    await obj.start(newDraft(), WINDOW);

    await obj.cancel();
    assert.equal(state.alarmAt(), null);
    assert.equal(outbound.sent.length, 0);
    assert.equal(await obj.approve(), 'closed', 'a cancelled draft can never be filed');
  } finally {
    outbound.restore();
  }
});

test('editing pushes the deadline back', async () => {
  const { state, obj } = core();
  await obj.start(newDraft(), WINDOW);
  const armed = state.alarmAt()!;
  await new Promise((r) => setTimeout(r, 5));

  const edited = await obj.edit({
    title: 'Kodepos kosong',
    url: null,
    why: null,
    acceptance: ['Kodepos terisi otomatis'],
  });

  assert.equal(edited!.issue.title, 'Kodepos kosong');
  assert.ok(state.alarmAt()! > armed, 'someone still working on it deserves the full window');
});

test('a finished draft refuses edits instead of quietly accepting them', async () => {
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);
    await obj.approve();

    assert.equal(await obj.priority(4), null);
    assert.equal(
      await obj.edit({ title: 'x', url: null, why: null, acceptance: [] }),
      null,
    );
  } finally {
    outbound.restore();
  }
});

test('an alarm Todoist rejects retries instead of dropping the report', async () => {
  const real = globalThis.fetch;
  let todoist = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    if (url.includes('todoist')) {
      todoist++;
      return new Response('nope', { status: 500 });
    }
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  }) as any;

  try {
    const { state, obj } = core();
    await obj.start(newDraft(), WINDOW);

    await obj.fire();
    assert.equal((await obj.read())!.status, 'pending', 'a failed write must not look filed');
    assert.ok(state.alarmAt()! > Date.now(), 'it must come back and try again');

    await obj.fire();
    await obj.fire();
    assert.equal(todoist, 3, 'three attempts, then it gives up and logs');

    const armed = state.alarmAt();
    await obj.fire();
    assert.equal(state.alarmAt(), armed, 'no fourth retry is scheduled');
  } finally {
    globalThis.fetch = real;
  }
});
