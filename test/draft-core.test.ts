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

/** The private card, addressed to the reporter alone. */
const cardEditAt = (o: ReturnType<typeof captureFetch>) =>
  o.sent.findIndex((r) => r.url.includes('/messages/@original'));

/** The public note, addressed to everyone in the channel. */
const announcementAt = (o: ReturnType<typeof captureFetch>) =>
  o.sent.findIndex(
    (r) => r.url.includes('/webhooks/') && !r.url.includes('/messages/@original'),
  );

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

test('a draft the alarm files is still announced to the channel', async () => {
  // Whether the reporter pressed Approve or wandered off, the issue now exists
  // and the people who share the channel have the same reason to hear about it.
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);
    await obj.fire();

    assert.ok(announcementAt(outbound) >= 0, 'an abandoned draft must still be announced');
  } finally {
    outbound.restore();
  }
});

test('the announcement follows the card edit, or Discord swallows it', async () => {
  // Posting a follow-up before the deferred message has been replaced makes
  // Discord edit that loading message instead of creating a new one, and it
  // drops the flags — so the public note would silently never appear.
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);
    await obj.fire();

    assert.ok(cardEditAt(outbound) >= 0, 'the card must still be edited');
    assert.ok(
      cardEditAt(outbound) < announcementAt(outbound),
      'the card edit must come first',
    );
  } finally {
    outbound.restore();
  }
});

test('a draft that never reached Todoist is not announced', async () => {
  // Announcing a failure would tell the channel about work that does not exist.
  const outbound = captureFetch(null);
  try {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input?.url ?? input);
      outbound.sent.push({
        url,
        body: init?.body ? JSON.parse(init.body) : null,
        method: String(init?.method ?? 'GET').toUpperCase(),
      });
      // Todoist refuses; Discord still answers, so the reporter hears about it.
      return url.includes('todoist')
        ? new Response('nope', { status: 500 })
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    try {
      const { obj } = core();
      await obj.start(newDraft(), WINDOW);
      await obj.fire();
    } finally {
      globalThis.fetch = real;
    }

    assert.equal(announcementAt(outbound), -1, 'a failed filing must stay quiet');
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
    subtasks: ['Kodepos terisi otomatis'],
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
      await obj.edit({ title: 'x', url: null, why: null, subtasks: [] }),
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

test('clicking Approve twice files exactly one Todoist task', async () => {
  // The card gives no sign it is working, so a second click is the natural
  // thing to do. It must cost nothing.
  const outbound = captureFetch();
  try {
    const { obj } = core();
    await obj.start(newDraft(), WINDOW);

    const first = await obj.approve();
    const second = await obj.approve();

    assert.notEqual(first, 'closed', 'the first click is the one that files');
    assert.equal(second, 'closed', 'the second must bounce off the claim');

    const created = outbound.sent.filter((call) => call.url.endsWith('/tasks'));
    assert.equal(created.length, 1, `Todoist was written ${created.length} times`);
  } finally {
    outbound.restore();
  }
});


