import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRawInput, type IssueContext } from '../src/issue.ts';
import type { ProcessResult } from '../src/process.ts';
import { announcementMessage } from '../src/result.ts';

const context: Omit<IssueContext, 'normalized'> = {
  command: 'issue',
  rawInput: 'tombol checkout ketutup navbar, pelanggan tidak bisa bayar',
  author: 'Riza Abdillah',
  authorUsername: 'anunriza',
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

const EPHEMERAL = 1 << 6;

test('the announcement is visible to the channel, not just the reporter', () => {
  // The whole point of the message: an ephemeral flag here would make it a
  // second private card and tell nobody anything.
  const body = announcementMessage(filed(), context) as any;

  assert.ok(((body.flags ?? 0) & EPHEMERAL) === 0, 'the announcement must not be ephemeral');
});

test('the announcement names who filed it', () => {
  const body = announcementMessage(filed(), context) as any;
  assert.match(JSON.stringify(body), /Riza Abdillah/);
});

test('the announcement carries the title, so the channel knows what it is about', () => {
  const body = announcementMessage(filed(), context) as any;
  assert.match(JSON.stringify(body), /Checkout tertutup navbar/);
});

test('the announcement never repeats what the reporter typed', () => {
  // Only the title, which the reporter wrote as a one-liner for others to read.
  // The raw description can carry anything, and this message is public.
  const body = announcementMessage(filed(), context) as any;

  assert.doesNotMatch(JSON.stringify(body), /pelanggan tidak bisa bayar/);
});

test('the announcement says how many subtasks came out of it', () => {
  const body = announcementMessage(filed({ subtasksCreated: 4 }), context) as any;
  assert.match(JSON.stringify(body), /4 sub-task/);
});

test('an issue with no subtasks says nothing about them', () => {
  const body = announcementMessage(filed(), context) as any;
  assert.doesNotMatch(JSON.stringify(body), /sub-task/);
});

test('the announcement links to the task in Todoist', () => {
  const body = announcementMessage(filed(), context) as any;
  assert.match(JSON.stringify(body), /app\.todoist\.com\/app\/task\/42/);
});

test('someone filing another person\'s message is credited as the filer', () => {
  // Two people are involved, and the channel should see both rather than
  // reading the report as the clicker's own.
  const body = announcementMessage(filed(), {
    ...context,
    author: 'Dota',
    filedBy: 'Riza Abdillah',
  }) as any;

  assert.match(JSON.stringify(body), /Dota/);
  assert.match(JSON.stringify(body), /Riza Abdillah/);
});
