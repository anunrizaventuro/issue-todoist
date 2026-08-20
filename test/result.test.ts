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

test('the reply says how many acceptance criteria were created', async () => {
  assert.match(footer(filed({ subtasksCreated: 3 })), /3 acceptance/);
});

test('no acceptance note is shown when the issue had none', async () => {
  assert.ok(!footer(filed()).includes('acceptance'));
});

test('acceptance criteria that failed to save are called out, not silently dropped', async () => {
  // The task is already filed, so the only way the reporter learns a child is
  // missing is being told here.
  const text = footer(filed({ subtasksCreated: 2, subtasksFailed: 1 }));
  assert.match(text, /2 acceptance/);
  assert.match(text, /1 acceptance gagal/);
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

test('an un-normalized report is still filed, with its Todoist link intact', async () => {
  // The distinction is a warning, not a failure — the task exists either way.
  const body = resultMessage(filed({ normalized: false }), context) as any;

  assert.equal(body.components[0].components[0].url, 'https://app.todoist.com/app/task/42');
  assert.match(body.embeds[0].description, /Checkout tertutup navbar/);
});

test('a normalized report keeps the plain success reply', async () => {
  const body = resultMessage(filed(), context) as any;
  assert.match(body.embeds[0].title, /✅/);
});

test('images that reached Todoist are reported as attached', async () => {
  assert.match(footer(filed({ attachmentsUploaded: 2 })), /2 gambar terlampir/);
});

test('images that never made it are called out with the reason', async () => {
  // The task is already filed, so this is the only place the reporter finds out.
  const text = footer(filed({ attachmentsUploaded: 1, attachmentsFailed: 1 }));
  assert.match(text, /1 gambar terlampir/);
  assert.match(text, /1 gambar gagal diunggah/);
  assert.match(text, /5 MB/);
});

test('a report with no images says nothing about images', async () => {
  assert.ok(!footer(filed()).includes('gambar'));
});
