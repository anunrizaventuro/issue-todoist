import assert from 'node:assert/strict';
import test from 'node:test';

import { fileIssue } from '../src/process.ts';
import { reviewMessage } from '../src/review.ts';
import { buildEditModal } from '../src/discord.ts';
import type { Draft } from '../src/draft.ts';
import { captureFetch, env } from './helpers.ts';

/**
 * A draft exactly as the previous deploy left it in Durable Object storage.
 *
 * Ten issue fields and no reporter handles. Written
 * as a JSON round-trip because that is literally how it comes back, and because
 * a hand-written object would let TypeScript quietly correct the shape being
 * tested.
 */
function legacyDraft(): Draft {
  return JSON.parse(
    JSON.stringify({
      id: '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      status: 'pending',
      issue: {
        title: 'Kodepos tidak terisi otomatis',
        problem: 'Kodepos kosong saat alamat dipilih.',
        expected: 'Kodepos terisi dari kelurahan.',
        action: 'Pilih kelurahan di checkout.',
        priority: 2,
        dueString: 'tomorrow',
        url: 'https://app.example.com/checkout',
        why: 'pelanggan batal checkout',
        subtasks: ['pecah alamat jadi bertingkat'],
        needsClarification: false,
        clarification: null,
      },
      context: {
        command: 'issue',
        rawInput: 'kodepos ga keisi otomatis',
        author: 'rifa',
        filedBy: null,
        sourceLink: null,
        typedTitle: null,
        pageUrl: null,
        why: 'pelanggan batal checkout',
        attachments: [],
        normalized: true,
      },
      reporterId: '123',
      applicationId: '1',
      token: 'tok',
      taskUrl: null,
    }),
  ) as Draft;
}

test('a draft from the previous deploy still reaches Todoist', async () => {
  const draft = legacyDraft();
  const { sent, restore } = captureFetch();
  let result;
  try {
    result = await fileIssue(env, draft.issue, draft.context);
  } finally {
    restore();
  }

  assert.equal(result.error, null, 'a shape change must never strand a report');
  assert.ok(result.task);

  const task = sent.find((call) => call.url.endsWith('/tasks'))!;
  assert.equal(task.body.content, 'Kodepos tidak terisi otomatis');
  assert.match(task.body.description, /pelanggan batal checkout/);
  assert.match(task.body.description, /kodepos ga keisi otomatis/, 'the quote still carries it');
});

test('a legacy draft keeps its subtask list, because the field means the same again', async () => {
  const draft = legacyDraft();
  const { sent, restore } = captureFetch();
  try {
    await fileIssue(env, draft.issue, draft.context);
  } finally {
    restore();
  }

  const children = sent.filter((call) => call.url.endsWith('/tasks') && call.body.parent_id);
  assert.deepEqual(children.map((c) => c.body.content), ['pecah alamat jadi bertingkat']);
});

test('a legacy draft renders a review card with three buttons', () => {
  const card: any = reviewMessage(legacyDraft(), 10);
  const names = card.embeds[0].fields.map((f: any) => f.name);

  assert.deepEqual(names, ['Halaman', 'Kenapa penting', 'Sub-task']);
  assert.deepEqual(
    card.components[0].components.map((b: any) => b.label),
    ['Approve', 'Edit', 'Batal'],
  );
});

test('a draft with no subtask list at all opens the modal without crashing', () => {
  // Belt and braces: the `?? []` guards a shape no deploy has actually written,
  // but a draft hand-edited or half-written must not take the modal down.
  const draft = legacyDraft();
  delete (draft.issue as { subtasks?: string[] }).subtasks;

  const modal: any = buildEditModal(draft);
  const box = modal.data.components.find((c: any) => c.component.custom_id === 'subtasks');

  assert.ok(box, 'the field must be offered even when the draft has no list');
  assert.equal(box.component.value, '');
});
