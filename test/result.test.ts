import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRawInput, type IssueContext } from '../src/issue.ts';
import type { ProcessResult } from '../src/process.ts';
import { resultMessage } from '../src/result.ts';

const context: Omit<IssueContext, 'normalized'> = {
  command: 'issue',
  rawInput: 'tombol checkout ketutup navbar',
  author: 'rifa',
  authorUsername: null,
  filedBy: null,
  filedByUsername: null,
  sourceLink: null,
  typedTitle: null,
  why: null,
  pageUrl: null,
  attachments: [],
};

const filed = (over: Partial<ProcessResult> = {}): ProcessResult => ({
  issue: { ...fromRawInput(context.rawInput), title: 'Checkout tertutup navbar' },
  task: { id: '42', url: 'https://app.todoist.com/app/task/42' },
  error: null,
  normalized: true,
  subtasksCreated: 0,
  subtasksFailed: 0,
  attachmentsUploaded: 0,
  attachmentsFailed: 0,
  ...over,
});

const footer = (result: ProcessResult) =>
  ((resultMessage(result, context) as any).embeds[0].footer?.text ?? '') as string;



test('subtasks that failed to save are called out, not silently dropped', async () => {
  // The task is already filed, so the only way the reporter learns a child is
  // missing is being told here.
  const text = footer(filed({ subtasksCreated: 2, subtasksFailed: 1 }));
  assert.match(text, /2 sub-task/);
  assert.match(text, /1 sub-task gagal/);
});

test('a failed submission still hands the reporter their own text back', async () => {
  const body = resultMessage(filed({ task: null, error: 'boom' }), context) as any;
  assert.ok(body.embeds[0].description.includes(context.rawInput));
});

test('a report the model never touched says so, instead of claiming it was tidied up', async () => {
  // The reporter has no other signal: the raw-text path produces a task that
  // looks filed and complete, and `needs-triage` only shows up in Todoist.
  const body = resultMessage(filed({ normalized: false }), context) as any;

  assert.doesNotMatch(body.embeds[0].title, /✅/);
  assert.match(body.embeds[0].title, /belum dirapikan/i);
});

test('an un-normalized report is still filed, and still shows what was recorded', async () => {
  // The distinction is a warning, not a failure — the task exists either way.
  const body = resultMessage(filed({ normalized: false }), context) as any;

  assert.match(body.embeds[0].description, /Checkout tertutup navbar/);
});


test('a submission that never reached Todoist offers no link to it', async () => {
  // There is nothing to open, and a button pointing nowhere is worse than none.
  const body = resultMessage(filed({ task: null, error: 'boom' }), context) as any;

  assert.doesNotMatch(JSON.stringify(body), /todoist\.com/);
});



test('images that never made it are called out with the reason', async () => {
  // The task is already filed, so this is the only place the reporter finds out.
  const text = footer(filed({ attachmentsUploaded: 1, attachmentsFailed: 1 }));
  assert.match(text, /1 gambar terlampir/);
  assert.match(text, /1 gambar gagal diunggah/);
  assert.match(text, /5 MB/);
});


test('a clean filing gets a one-line receipt, not a second copy of the announcement', async () => {
  // The public note already carries the title, the count and the link. Repeating
  // all three privately is what made one report read as two conversations.
  const body = resultMessage(filed({ subtasksCreated: 3 }), context) as any;
  const text = JSON.stringify(body);

  assert.match(text, /✅/, 'it still has to confirm something happened');
  assert.doesNotMatch(text, /Checkout tertutup navbar/, 'the title belongs to the announcement');
  assert.doesNotMatch(text, /todoist\.com/, 'so does the link');
  assert.doesNotMatch(text, /3 sub-task/, 'and so does the count');
});

test('the receipt is still only for the reporter', async () => {
  const body = resultMessage(filed(), context) as any;
  assert.equal(body.flags, 1 << 6);
});

test('a report the model never touched keeps the full card', async () => {
  // "belum dirapikan" appears nowhere else — not in the announcement, not in
  // Todoist except as a label. Shrinking this one would drop the only copy.
  const body = resultMessage(filed({ normalized: false }), context) as any;
  const text = JSON.stringify(body);

  assert.match(text, /belum dirapikan/i);
  assert.match(text, /Checkout tertutup navbar/, 'the full card still names the issue');
  assert.match(text, /todoist\.com/, 'and still links to it');
});

test('a subtask that failed to save keeps the full card', async () => {
  const body = resultMessage(filed({ subtasksCreated: 2, subtasksFailed: 1 }), context) as any;
  assert.match(JSON.stringify(body), /1 sub-task gagal/);
});
