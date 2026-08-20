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
 * Ten issue fields, none of them `acceptance`, and no reporter handles. Written
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

test('a legacy draft files no child tasks rather than crashing on the missing list', async () => {
  const draft = legacyDraft();
  const { sent, restore } = captureFetch();
  try {
    await fileIssue(env, draft.issue, draft.context);
  } finally {
    restore();
  }

  // The old `subtasks` list is deliberately not migrated: it held units of work,
  // not conditions of done, so filing it as acceptance would misrepresent it.
  assert.equal(sent.filter((call) => call.url.endsWith('/tasks')).length, 1);
});

test('a legacy draft renders a review card without acceptance', () => {
  const card: any = reviewMessage(legacyDraft(), 10);
  const names = card.embeds[0].fields.map((f: any) => f.name);

  assert.deepEqual(names, ['Halaman', 'Kenapa penting']);
  assert.deepEqual(
    card.components[0].components.map((b: any) => b.label),
    ['Approve', 'Edit', 'Batal'],
  );
});

test('a legacy draft opens the edit modal with an empty acceptance box', () => {
  const modal: any = buildEditModal(legacyDraft());
  const box = modal.data.components.find((c: any) => c.component.custom_id === 'acceptance');

  assert.ok(box, 'the field must be offered even when the draft predates it');
  assert.equal(box.component.value, '');
});
