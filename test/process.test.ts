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

/** A fully configured provider, pointed at a host the stub below intercepts. */
const configured = {
  ...env,
  LLM_BASE_URL: 'https://llm.example.com/v1',
  LLM_MODEL: 'test-model',
  LLM_API_KEY: 'key',
};

/** Routes by host so neither the provider nor Todoist is actually contacted. */
function stubFetch(completion: string | null) {
  const sent: any[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input);
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });

    if (url.includes('llm.example.com')) {
      if (completion === null) return new Response('{"error":{}}', { status: 500 });
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          choices: [{ index: 0, message: { role: 'assistant', content: completion }, finish_reason: 'stop' }],
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

test('with a provider configured, the issue reaches Todoist normalized', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission(configured, context);

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

test('the configured model is the one actually called', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    await processSubmission({ ...configured, LLM_MODEL: 'vendor/some-other-model' }, context);

    const call = sent.find((r) => r.url.includes('llm.example.com'))!;
    assert.equal(call.url, 'https://llm.example.com/v1/chat/completions');
    assert.equal(call.body.model, 'vendor/some-other-model');
  } finally {
    restore();
  }
});

test('without provider config, the raw text is filed for triage instead', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission(env, context);

    assert.equal(result.issue.title, context.rawInput);
    assert.ok(!sent.some((r) => r.url.includes('llm.example.com')), 'no provider must be called');
    assert.ok(todoistBody(sent).labels.includes(TRIAGE_LABEL));
  } finally {
    restore();
  }
});

test('a half-filled config is treated as no config rather than a failed call', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission({ ...configured, LLM_API_KEY: '' }, context);

    assert.equal(result.issue.title, context.rawInput);
    assert.ok(!sent.some((r) => r.url.includes('llm.example.com')), 'no provider must be called');
  } finally {
    restore();
  }
});

test('a failing provider call still files the issue, labelled for triage', async () => {
  const { sent, restore } = stubFetch(null);
  try {
    const result = await processSubmission(configured, context);

    assert.equal(result.error, null, 'a provider outage must not fail the submission');
    assert.equal(result.issue.title, context.rawInput);
    assert.ok(todoistBody(sent).labels.includes(TRIAGE_LABEL));
  } finally {
    restore();
  }
});
