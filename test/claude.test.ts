import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeIssue } from '../src/claude.ts';

/** A full Claude response whose single text block is `text`. */
function reply(text: string, status = 200) {
  const body =
    status === 200
      ? JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      : JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'nope' } });

  return async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

const GOOD = JSON.stringify({
  title: 'Tombol checkout tidak muncul di mobile',
  problem: 'Di layar kecil tombol checkout tidak terlihat.',
  expected: 'Tombol checkout terlihat di semua ukuran layar.',
  action: 'Buka katalog di ponsel, tambah barang, buka keranjang.',
  priority: 3,
  dueString: null,
  needsClarification: false,
  clarification: null,
});

test('a well-formed reply becomes a normalized issue', async () => {
  const issue = await normalizeIssue('key', 'tombol checkout ga muncul di hp', reply(GOOD));

  assert.ok(issue);
  assert.equal(issue.title, 'Tombol checkout tidak muncul di mobile');
  assert.equal(issue.priority, 3);
  assert.equal(issue.needsClarification, false);
});

test('an API error yields null so the caller can fall back', async () => {
  const issue = await normalizeIssue('key', 'apa saja', reply('', 400));
  assert.equal(issue, null);
});

test('a non-JSON reply yields null rather than throwing', async () => {
  const issue = await normalizeIssue('key', 'apa saja', reply('maaf, saya tidak bisa'));
  assert.equal(issue, null);
});

test('a reply missing required fields yields null', async () => {
  const issue = await normalizeIssue('key', 'apa saja', reply(JSON.stringify({ title: 'cuma judul' })));
  assert.equal(issue, null);
});

test('an out-of-range priority yields null instead of a bad Todoist call', async () => {
  // Todoist only accepts 1-4; anything else is rejected by the API.
  const issue = await normalizeIssue('key', 'apa saja', reply(JSON.stringify({ ...JSON.parse(GOOD), priority: 9 })));
  assert.equal(issue, null);
});

test('an over-long title is clipped to what Todoist can display', async () => {
  const long = 'x'.repeat(300);
  const issue = await normalizeIssue('key', 'apa saja', reply(JSON.stringify({ ...JSON.parse(GOOD), title: long })));

  assert.ok(issue);
  assert.ok(issue.title.length <= 100, `title was ${issue.title.length} chars`);
});

test('the raw text is sent to Claude as the user message', async () => {
  let seen: any;
  const spy = async (_url: any, init: any) => {
    seen = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: [{ type: 'text', text: GOOD }], stop_reason: 'end_turn',
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  await normalizeIssue('key', 'tombol checkout ga muncul', spy as any);

  assert.equal(seen.model, 'claude-opus-5');
  assert.equal(seen.output_config.format.type, 'json_schema');
  assert.match(JSON.stringify(seen.messages), /tombol checkout ga muncul/);
});
