import assert from 'node:assert/strict';
import test from 'node:test';

import { configFromEnv, normalizeIssue, type LlmConfig } from '../src/llm.ts';
import { env } from './helpers.ts';

const config: LlmConfig = {
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'secret',
};

/** An OpenAI-compatible chat completion whose single choice contains `content`. */
function reply(content: string, status = 200) {
  const body =
    status === 200
      ? JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          model: 'test-model',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      : JSON.stringify({ error: { type: 'invalid_request_error', message: 'nope' } });

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
  const issue = await normalizeIssue(config, 'tombol checkout ga muncul di hp', reply(GOOD));

  assert.ok(issue);
  assert.equal(issue.title, 'Tombol checkout tidak muncul di mobile');
  assert.equal(issue.priority, 3);
  assert.equal(issue.needsClarification, false);
});

test('an API error yields null so the caller can fall back', async () => {
  const issue = await normalizeIssue(config, 'apa saja', reply('', 400));
  assert.equal(issue, null);
});

test('a non-JSON reply yields null rather than throwing', async () => {
  const issue = await normalizeIssue(config, 'apa saja', reply('maaf, saya tidak bisa'));
  assert.equal(issue, null);
});

test('a refusal yields null instead of a task full of apology text', async () => {
  const refused = async () =>
    new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ index: 0, message: { role: 'assistant', content: null, refusal: 'tidak bisa' }, finish_reason: 'stop' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  assert.equal(await normalizeIssue(config, 'apa saja', refused), null);
});

test('a reply missing required fields yields null', async () => {
  const issue = await normalizeIssue(config, 'apa saja', reply(JSON.stringify({ title: 'cuma judul' })));
  assert.equal(issue, null);
});

test('an out-of-range priority yields null instead of a bad Todoist call', async () => {
  // Todoist only accepts 1-4; anything else is rejected by the API.
  const issue = await normalizeIssue(config, 'apa saja', reply(JSON.stringify({ ...JSON.parse(GOOD), priority: 9 })));
  assert.equal(issue, null);
});

test('an over-long title is clipped to what Todoist can display', async () => {
  const long = 'x'.repeat(300);
  const issue = await normalizeIssue(config, 'apa saja', reply(JSON.stringify({ ...JSON.parse(GOOD), title: long })));

  assert.ok(issue);
  assert.ok(issue.title.length <= 100, `title was ${issue.title.length} chars`);
});

test('the configured model and the raw text are sent to the chat completions endpoint', async () => {
  let seen: any;
  let seenUrl = '';
  let seenAuth = '';

  await normalizeIssue(config, 'tombol checkout ga muncul', (async (url: any, init: any) => {
    seenUrl = String(url);
    seenAuth = new Headers(init.headers).get('authorization') ?? '';
    seen = JSON.parse(init.body);
    return reply(GOOD)();
  }) as any);

  assert.equal(seenUrl, 'https://api.example.com/v1/chat/completions');
  assert.equal(seenAuth, 'Bearer secret');
  assert.equal(seen.model, 'test-model');
  assert.equal(seen.response_format.type, 'json_schema');
  assert.match(JSON.stringify(seen.messages), /tombol checkout ga muncul/);
});

test('a base URL with a trailing slash does not produce a doubled path', async () => {
  let seenUrl = '';
  await normalizeIssue({ ...config, baseUrl: 'https://api.example.com/v1/' }, 'apa saja', (async (url: any) => {
    seenUrl = String(url);
    return reply(GOOD)();
  }) as any);

  assert.equal(seenUrl, 'https://api.example.com/v1/chat/completions');
});

test('configFromEnv returns a config once all three settings are present', () => {
  const result = configFromEnv({
    ...env,
    LLM_BASE_URL: 'https://openrouter.ai/api/v1',
    LLM_MODEL: 'anthropic/claude-opus-5',
    LLM_API_KEY: 'sk-test',
  });

  assert.deepEqual(result, {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-opus-5',
    apiKey: 'sk-test',
  });
});

test('configFromEnv returns null when any setting is missing, so the raw text passes through', () => {
  const full = { ...env, LLM_BASE_URL: 'https://api.example.com/v1', LLM_MODEL: 'm', LLM_API_KEY: 'k' };

  assert.equal(configFromEnv({ ...full, LLM_BASE_URL: '' }), null);
  assert.equal(configFromEnv({ ...full, LLM_MODEL: '' }), null);
  assert.equal(configFromEnv({ ...full, LLM_API_KEY: '  ' }), null);
});

test('every schema field is named in the prompt, for providers that ignore response_format', async () => {
  // Not every OpenAI-compatible provider implements json_schema. When one
  // ignores it, the model still has to know the exact shape to emit.
  let seen: any;
  await normalizeIssue(config, 'apa saja', (async (_url: any, init: any) => {
    seen = JSON.parse(init.body);
    return reply(GOOD)();
  }) as any);

  const system = seen.messages[0].content;
  for (const field of Object.keys(JSON.parse(GOOD))) {
    assert.match(system, new RegExp(field), `${field} is missing from the prompt`);
  }
});

test('streaming is switched off explicitly, since some gateways stream by default', async () => {
  // A gateway that streams returns `data: {...}` SSE frames, which are not JSON
  // and would sink every submission to the raw-text fallback.
  let seen: any;
  await normalizeIssue(config, 'apa saja', (async (_url: any, init: any) => {
    seen = JSON.parse(init.body);
    return reply(GOOD)();
  }) as any);

  assert.equal(seen.stream, false);
});
