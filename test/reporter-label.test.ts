import assert from 'node:assert/strict';
import test from 'node:test';

import { fileIssue } from '../src/process.ts';
import { fromRawInput, type IssueContext } from '../src/issue.ts';
import { REVIEW_LABEL, reporterLabels } from '../src/todoist.ts';
import { captureFetch, env } from './helpers.ts';

/** A filed-by-nobody-else submission; each test overrides what it cares about. */
function context(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    command: 'issue',
    rawInput: 'checkout ketutup navbar',
    author: 'Budi Santoso',
    authorUsername: 'budi',
    filedBy: null,
    filedByUsername: null,
    sourceLink: null,
    typedTitle: null,
    pageUrl: null,
    why: null,
    attachments: [],
    normalized: true,
    ...overrides,
  };
}

test('the reporter gets one label', () => {
  assert.deepEqual(reporterLabels(context()), ['dari-budi']);
});

test('filing someone else\'s message labels both people', () => {
  const labels = reporterLabels(
    context({ filedBy: 'Sari', filedByUsername: 'sari' }),
  );
  assert.deepEqual(labels, ['dari-budi', 'dicatat-sari']);
});

test('filing your own message labels you once', () => {
  // handler.ts leaves filedBy null when the clicker wrote the message.
  assert.deepEqual(reporterLabels(context({ filedBy: null, filedByUsername: null })), ['dari-budi']);
});

test('no username means no label, rather than a dari-unknown bucket', () => {
  assert.deepEqual(reporterLabels(context({ authorUsername: null })), []);
});

test('a missing filer username does not label the filer', () => {
  const labels = reporterLabels(context({ filedBy: 'Sari', filedByUsername: null }));
  assert.deepEqual(labels, ['dari-budi']);
});

test('legacy usernames are sanitised into something Todoist can filter', () => {
  // Todoist filter syntax is `@label`, which breaks on spaces.
  const labels = reporterLabels(context({ authorUsername: 'Budi Santoso!' }));
  assert.deepEqual(labels, ['dari-budi-santoso']);
});

test('dots and underscores survive, because Discord handles use them', () => {
  assert.deepEqual(reporterLabels(context({ authorUsername: 'budi.dev_01' })), ['dari-budi.dev_01']);
});

test('a username of only punctuation produces no label', () => {
  assert.deepEqual(reporterLabels(context({ authorUsername: '!!!' })), []);
});

test('labels stay inside the 128 character limit Todoist documents', () => {
  const labels = reporterLabels(context({ authorUsername: 'b'.repeat(200) }));
  assert.equal(labels.length, 1);
  assert.equal(labels[0]?.length, 128);
});

test('a draft stored before this field existed does not throw', () => {
  // Drafts live in Durable Object storage as JSON, so ones written by the
  // previous deploy deserialise with these fields absent entirely.
  const old = context();
  delete (old as Partial<IssueContext>).authorUsername;
  delete (old as Partial<IssueContext>).filedByUsername;

  assert.deepEqual(reporterLabels(old), []);
});

test('the labels reach Todoist alongside the ones the caller passed', async () => {
  const { sent, restore } = captureFetch();
  try {
    await fileIssue(
      env,
      fromRawInput('checkout ketutup navbar'),
      context({ filedBy: 'Sari', filedByUsername: 'sari' }),
      [REVIEW_LABEL],
    );
  } finally {
    restore();
  }

  const task = sent.find((call) => call.url.endsWith('/tasks'));
  assert.ok(task, 'no task was created');
  assert.ok(task.body.labels.includes('dari-budi'));
  assert.ok(task.body.labels.includes('dicatat-sari'));
  assert.ok(task.body.labels.includes(REVIEW_LABEL), 'caller labels must survive');
  assert.ok(task.body.labels.includes('discord'), 'command labels must survive');
});

/**
 * The plumbing, from a real Discord payload through to the Todoist call.
 *
 * The pure function above cannot catch a handler that forgets to read the
 * handle off the interaction, which is the mistake most likely to happen when
 * someone adds a third entry point later.
 */
test('a right-clicked message labels the writer and the person who filed it', async () => {
  const { handleInteraction } = await import('../src/handler.ts');
  const { signed } = await import('./helpers.ts');

  const deferred: Promise<unknown>[] = [];
  const { sent, restore } = captureFetch();
  try {
    await handleInteraction(
      signed({
        type: 2,
        application_id: '1',
        token: 'tok',
        guild_id: 'g',
        channel_id: 'c',
        member: { user: { username: 'anun', global_name: 'Anun' } },
        data: {
          name: 'Buat Issue',
          type: 3,
          target_id: 'm1',
          resolved: {
            messages: {
              m1: {
                id: 'm1',
                content: 'checkout ketutup navbar di halaman produk',
                attachments: [],
                author: { username: 'rifa', global_name: 'Rifa' },
              },
            },
          },
        },
      }),
      // No draft binding, so this falls through to filing directly — which is
      // the path that actually reaches Todoist in this test.
      env,
      (p) => deferred.push(p),
    );
    await Promise.all(deferred);
  } finally {
    restore();
  }

  const task = sent.find((call) => call.url.endsWith('/tasks'));
  assert.ok(task, 'no task was created');
  assert.deepEqual(task.body.labels.filter((l: string) => l.startsWith('dari-')), ['dari-rifa']);
  assert.deepEqual(
    task.body.labels.filter((l: string) => l.startsWith('dicatat-')),
    ['dicatat-anun'],
  );
});
