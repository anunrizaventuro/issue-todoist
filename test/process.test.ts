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
  url: 'https://toko.example.com/produk',
  subtasks: ['Benerin z-index navbar', 'Uji di iOS Safari'],
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
  pageUrl: null,
};

/** A fully configured provider, pointed at a host the stub below intercepts. */
const configured = {
  ...env,
  LLM_BASE_URL: 'https://llm.example.com/v1',
  LLM_MODEL: 'test-model',
  LLM_API_KEY: 'key',
};

/** Routes by host so neither the provider nor Todoist is actually contacted. */
function stubFetch(completion: string | null, failSubtasks = false) {
  const sent: any[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input);
    const body = init?.body ? JSON.parse(init.body) : null;
    sent.push({ url, body });

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
    if (failSubtasks && body?.parent_id) {
      return new Response('{"error":"nope"}', { status: 500 });
    }
    return new Response(JSON.stringify({ id: body?.parent_id ? '43' : '42' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  return { sent, restore: () => { globalThis.fetch = real; } };
}

const todoistBody = (sent: any[]) =>
  sent.find((r) => r.url.includes('todoist') && !r.body?.parent_id)!.body;

const childBodies = (sent: any[]) =>
  sent.filter((r) => r.url.includes('todoist') && r.body?.parent_id).map((r) => r.body);

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

test('each subtask becomes a child of the created task, in order', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission(configured, context);

    const children = childBodies(sent);
    assert.deepEqual(children.map((c) => c.content), ['Benerin z-index navbar', 'Uji di iOS Safari']);
    assert.ok(children.every((c) => c.parent_id === '42'), 'children must hang off the task just created');
    assert.equal(result.subtasksCreated, 2);
    assert.equal(result.subtasksFailed, 0);
  } finally {
    restore();
  }
});

test('a report with no subtasks makes no extra Todoist calls', async () => {
  const { sent, restore } = stubFetch(JSON.stringify({ ...JSON.parse(NORMALIZED), subtasks: [] }));
  try {
    const result = await processSubmission(configured, context);

    assert.equal(childBodies(sent).length, 0);
    assert.equal(result.subtasksCreated, 0);
  } finally {
    restore();
  }
});

test('a subtask that cannot be saved does not fail the submission', async () => {
  // The main task is already stored by then; discarding it because a child
  // write failed would lose the report over a detail.
  const { sent, restore } = stubFetch(NORMALIZED, true);
  try {
    const result = await processSubmission(configured, context);

    assert.equal(result.error, null);
    assert.ok(result.task, 'the main task must survive a failing child write');
    assert.equal(result.subtasksCreated, 0);
    assert.equal(result.subtasksFailed, 2);
    assert.equal(childBodies(sent).length, 2, 'one failure must not abort the rest');
  } finally {
    restore();
  }
});

test('the URL typed into the form wins over the one the model produced', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission(configured, {
      ...context,
      pageUrl: 'https://toko.example.com/keranjang',
    });

    assert.equal(result.issue.url, 'https://toko.example.com/keranjang');
    assert.match(todoistBody(sent).description, /toko\.example\.com\/keranjang/);
    assert.ok(
      !todoistBody(sent).description.includes('/produk'),
      "the model's guess must not appear alongside the reporter's own answer",
    );
  } finally {
    restore();
  }
});

test('the model-found URL is used when the form field was left empty', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    await processSubmission(configured, context);
    assert.match(todoistBody(sent).description, /toko\.example\.com\/produk/);
  } finally {
    restore();
  }
});

test('the form URL survives even when no model ran at all', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission(env, { ...context, pageUrl: 'https://toko.example.com/keranjang' });

    assert.equal(result.issue.url, 'https://toko.example.com/keranjang');
    assert.match(todoistBody(sent).description, /\*\*Halaman\*\*/);
  } finally {
    restore();
  }
});

test('a form URL that is not a link is dropped rather than filed', async () => {
  const { sent, restore } = stubFetch(NORMALIZED);
  try {
    const result = await processSubmission(env, { ...context, pageUrl: 'halaman keranjang' });

    assert.equal(result.issue.url, null);
    assert.ok(!todoistBody(sent).description.includes('**Halaman**'));
  } finally {
    restore();
  }
});
