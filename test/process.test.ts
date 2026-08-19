import assert from 'node:assert/strict';
import test from 'node:test';

import { processSubmission } from '../src/process.ts';
import { TRIAGE_LABEL } from '../src/todoist.ts';
import { env } from './helpers.ts';

const NORMALIZED = JSON.stringify({
  title: 'Checkout tertutup navbar di halaman produk',
  problem: 'Navbar menutupi tombol checkout.',
  expected: 'Tombol checkout bisa diklik.',
  action: 'Buka halaman produk di ponsel.',
  priority: 2,
  dueString: null,
  needsClarification: false,
  clarification: null,
});

const context = {
  command: 'issue' as const,
  rawInput: 'checkout ketutup navbar anjir',
  author: 'rifa',
  filedBy: null,
  sourceLink: null,
  attachments: [],
};

/** Routes by host so neither Anthropic nor Todoist is actually contacted. */
function stubFetch(claudeText: string | null) {
  const sent: any[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input);
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });

    if (url.includes('anthropic.com')) {
      if (claudeText === null) return new Response('{"error":{}}', { status: 500 });
      return new Response(
        JSON.stringify({
          id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5',
          content: [{ type: 'text', text: claudeText }], stop_reason: 'end_turn',
          stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ id: '42' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  return { sent, restore: () => { globalThis.fetch = real; } };
}

const todoistBody = (sent: any[]) => sent.find((r) => r.url.includes('todoist'))!.body;

test('with a key set, the issue reaches Todoist normalized', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission({ ...env, ANTHROPIC_API_KEY: 'key' }, context);

    assert.equal(result.error, null);
    assert.equal(result.issue.title, 'Checkout tertutup navbar di halaman produk');

    const body = todoistBody(sent);
    assert.equal(body.priority, 2);
    assert.ok(!body.labels.includes(TRIAGE_LABEL), 'normalized issues do not need triage');
    assert.match(body.description, /\*\*Masalah\*\*/);
    assert.match(body.description, /Tulisan asli/, 'the original wording must survive');
  } finally {
    restore();
  }
});

test('without a key, the raw text is filed for triage instead', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission({ ...env, ANTHROPIC_API_KEY: '' }, context);

    assert.equal(result.issue.title, context.rawInput);
    assert.ok(!sent.some((r) => r.url.includes('anthropic')), 'Claude must not be called');
    assert.ok(todoistBody(sent).labels.includes(TRIAGE_LABEL));
  } finally {
    restore();
  }
});

test('a failing Claude call still files the issue, labelled for triage', async () => {
  const { sent, restore } = stubFetch(null);
  try {
    const result = await processSubmission({ ...env, ANTHROPIC_API_KEY: 'key' }, context);

    assert.equal(result.error, null, 'a Claude outage must not fail the submission');
    assert.equal(result.issue.title, context.rawInput);
    assert.ok(todoistBody(sent).labels.includes(TRIAGE_LABEL));
  } finally {
    restore();
  }
});
