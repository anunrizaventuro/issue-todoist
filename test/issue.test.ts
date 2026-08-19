import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRawInput, renderDescription, type IssueContext } from '../src/issue.ts';

const base: Omit<IssueContext, 'normalized'> = {
  command: 'issue',
  rawInput: 'tombol checkout ga muncul di mobile',
  author: 'rifa',
  filedBy: null,
  sourceLink: 'https://discord.com/channels/1/2',
  attachments: [],
};

test('title falls back to the first non-empty line', () => {
  const issue = fromRawInput('\n\n  checkout mobile error  \nkayaknya ketutup\ncoba cek');
  assert.equal(issue.title, 'checkout mobile error');
  assert.equal(issue.problem, '\n\n  checkout mobile error  \nkayaknya ketutup\ncoba cek');
});

test('a long title is cut at a word boundary, never mid-word', () => {
  const long = `${'panjang '.repeat(20)}selesai`;
  const { title } = fromRawInput(long);
  assert.ok(title.length <= 100, `got ${title.length}`);
  assert.ok(title.endsWith('…'));
  assert.ok(!/\bpanjan…$/.test(title), 'must not slice mid-word');
});

test('raw mode does not invent Masalah/Harapan/Langkah headings', () => {
  // Presenting unprocessed text under headings would imply a rigour that is
  // not there. Those headings only appear once the LLM has structured it.
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, { ...base, normalized: false });

  assert.ok(!body.includes('**Masalah**'));
  assert.ok(!body.includes('**Harapan**'));
  assert.ok(body.includes(base.rawInput), 'the user text must survive verbatim');
  assert.ok(body.includes('@rifa'));
});

test('normalized mode uses headings and keeps the original text quoted', () => {
  const issue = {
    ...fromRawInput(base.rawInput),
    problem: 'Tombol checkout tidak terlihat di mobile.',
    expected: 'Tombol tetap terlihat.',
    action: null,
  };
  const body = renderDescription(issue, { ...base, normalized: true });

  assert.ok(body.includes('**Masalah**'));
  assert.ok(body.includes('**Harapan**'));
  assert.ok(!body.includes('**Langkah**'), 'null sections must be omitted, not left empty');
  assert.ok(body.includes('> tombol checkout ga muncul di mobile'), 'original must be preserved');
});

test('attachments are listed with their expiry warning', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, {
    ...base,
    normalized: false,
    attachments: [
      {
        id: '1',
        filename: 'shot.png',
        size: 1024,
        url: 'https://cdn.discordapp.com/x.png?ex=1',
        proxy_url: 'https://media.discordapp.net/x.png',
      },
    ],
  });

  assert.ok(body.includes('[shot.png](https://cdn.discordapp.com/x.png?ex=1)'));
  assert.ok(body.includes('kedaluwarsa'), 'expiring links must be labelled as such');
});

test('a filer different from the writer is credited separately', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, { ...base, normalized: false, filedBy: 'anun' });

  assert.ok(body.includes('@rifa'), 'the person who wrote it stays the reporter');
  assert.ok(body.includes('dicatat oleh @anun'));
});

test('no filer credit is shown when the same person did both', () => {
  const issue = fromRawInput(base.rawInput);
  const body = renderDescription(issue, { ...base, normalized: false, filedBy: null });
  assert.ok(!body.includes('dicatat oleh'));
});
