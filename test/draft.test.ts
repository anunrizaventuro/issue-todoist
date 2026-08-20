import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEdit,
  applyPriority,
  claim,
  draftCustomId,
  isReporter,
  parseDraftCustomId,
  type Draft,
} from '../src/draft.ts';
import { fromRawInput } from '../src/issue.ts';

const ID = '0d1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function draft(overrides: Partial<Draft> = {}): Draft {
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
    ...overrides,
  };
}

test('custom_id survives the round trip and stays under Discord limit', () => {
  const id = draftCustomId('ok', ID);
  assert.ok(id.length <= 100, `custom_id is ${id.length} chars`);
  assert.deepEqual(parseDraftCustomId(id), { action: 'ok', id: ID, modal: false });
  assert.deepEqual(parseDraftCustomId(draftCustomId('edit', ID, true)), {
    action: 'edit',
    id: ID,
    modal: true,
  });
});

test('anything that is not a draft custom_id is refused', () => {
  assert.equal(parseDraftCustomId(undefined), null);
  assert.equal(parseDraftCustomId('issue:issue'), null);
  assert.equal(parseDraftCustomId(`d:nope:${ID}`), null);
  assert.equal(parseDraftCustomId('d:ok:'), null);
});

test('a draft can only be claimed once', () => {
  const filed = claim(draft(), 'filed');
  assert.equal(filed?.status, 'filed');
  // This is what stops a click and the alarm from both filing the same issue.
  assert.equal(claim(filed!, 'filed'), null);
  assert.equal(claim(filed!, 'cancelled'), null);
});

test('a cancelled draft cannot be filed afterwards', () => {
  const cancelled = claim(draft(), 'cancelled')!;
  assert.equal(claim(cancelled, 'filed'), null);
});

test('editing overwrites the model output, priority aside', () => {
  const before = draft();
  before.issue.acceptance = ['tebakan pertama model'];
  before.issue.priority = 3;

  const after = applyEdit(before, {
    title: 'Kodepos tidak terisi otomatis',
    url: 'https://app.example.com/checkout',
    why: 'pelanggan batal checkout',
    acceptance: ['Kodepos terisi otomatis dari alamat'],
  });

  assert.equal(after.issue.title, 'Kodepos tidak terisi otomatis');
  assert.equal(after.issue.url, 'https://app.example.com/checkout');
  assert.equal(after.issue.why, 'pelanggan batal checkout');
  assert.deepEqual(after.issue.acceptance, ['Kodepos terisi otomatis dari alamat']);
  assert.equal(after.issue.priority, 3, 'prioritas diatur dropdown, bukan modal');
  assert.equal(after.status, 'pending');
});

test('emptying the acceptance box leaves the issue with none', () => {
  const before = draft();
  before.issue.acceptance = ['tebakan yang salah'];

  const after = applyEdit(before, { title: 'judul', url: null, why: null, acceptance: [] });
  assert.deepEqual(after.issue.acceptance, [], 'a deliberate clear must not be undone');
});

test('an edit that is not a link leaves the url empty rather than dead', () => {
  const after = applyEdit(draft(), {
    title: 'judul',
    url: 'halaman keranjang',
    why: null,
    acceptance: [],
  });
  assert.equal(after.issue.url, null);
});

test('an edited title too long for Todoist is clipped', () => {
  const after = applyEdit(draft(), {
    title: 'x'.repeat(150),
    url: null,
    why: null,
    acceptance: [],
  });
  assert.ok(after.issue.title.length <= 100);
});

test('priority only accepts the Todoist scale', () => {
  assert.equal(applyPriority(draft(), 3).issue.priority, 3);
  assert.equal(applyPriority(draft(), 9).issue.priority, 1, 'out of range falls back to normal');
  assert.equal(applyPriority(draft(), Number.NaN).issue.priority, 1);
});

test('only the reporter owns the draft', () => {
  assert.equal(isReporter(draft(), '123'), true);
  assert.equal(isReporter(draft(), '999'), false);
  assert.equal(isReporter(draft(), undefined), false);
});
