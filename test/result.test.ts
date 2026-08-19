import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRawInput, type IssueContext } from '../src/issue.ts';
import type { ProcessResult } from '../src/process.ts';
import { resultMessage } from '../src/result.ts';

const context: Omit<IssueContext, 'normalized'> = {
  command: 'issue',
  rawInput: 'tombol checkout ketutup navbar',
  author: 'rifa',
  filedBy: null,
  sourceLink: null,
  pageUrl: null,
  attachments: [],
};

const filed = (over: Partial<ProcessResult> = {}): ProcessResult => ({
  issue: { ...fromRawInput(context.rawInput), title: 'Checkout tertutup navbar' },
  task: { id: '42', url: 'https://app.todoist.com/app/task/42' },
  error: null,
  subtasksCreated: 0,
  subtasksFailed: 0,
  ...over,
});

const footer = (result: ProcessResult) =>
  ((resultMessage(result, context) as any).embeds[0].footer?.text ?? '') as string;

test('the reply says how many subtasks were created', async () => {
  assert.match(footer(filed({ subtasksCreated: 3 })), /3 sub-task/);
});

test('no subtask note is shown when the issue had none', async () => {
  assert.ok(!footer(filed()).includes('sub-task'));
});

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
