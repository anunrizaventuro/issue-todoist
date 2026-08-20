import assert from 'node:assert/strict';
import test from 'node:test';

import { configFromEnv, MAX_SUBTASKS, normalizeIssue, TIMEOUT_MS, type LlmConfig } from '../src/llm.ts';
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
  priority: 3,
  url: 'https://toko.example.com/keranjang',
  subtasks: ['Perbaiki z-index navbar', 'Uji di iOS Safari'],
});

test('a well-formed reply becomes a normalized issue', async () => {
  const issue = await normalizeIssue(config, 'tombol checkout ga muncul di hp', reply(GOOD));

  assert.ok(issue);
  assert.equal(issue.title, 'Tombol checkout tidak muncul di mobile');
  assert.equal(issue.priority, 3);
  assert.deepEqual(issue.subtasks, ['Perbaiki z-index navbar', 'Uji di iOS Safari']);
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

test('the page URL and the subtask list survive into the normalized issue', async () => {
  const issue = await normalizeIssue(config, 'tombol checkout ga muncul di hp', reply(GOOD));

  assert.ok(issue);
  assert.equal(issue.url, 'https://toko.example.com/keranjang');
  assert.deepEqual(issue.subtasks, ['Perbaiki z-index navbar', 'Uji di iOS Safari']);
});

test('a reply without subtasks yields an empty list, not a failed normalization', async () => {
  // A report can describe one piece of work. A missing list is not a reason
  // to sink the whole submission to the raw-text fallback.
  const { subtasks: _drop, ...without } = JSON.parse(GOOD);
  const issue = await normalizeIssue(config, 'apa saja', reply(JSON.stringify(without)));

  assert.ok(issue, 'a missing subtasks field must not invalidate the issue');
  assert.deepEqual(issue.subtasks, []);
});

test('blank and non-string subtask entries are dropped', async () => {
  const issue = await normalizeIssue(
    config,
    'apa saja',
    reply(JSON.stringify({ ...JSON.parse(GOOD), subtasks: ['  Benerin navbar ', '', '   ', 42, null, { a: 1 }] })),
  );

  assert.ok(issue);
  assert.deepEqual(issue.subtasks, ['Benerin navbar']);
});

test('a subtasks field of the wrong type is treated as none', async () => {
  const issue = await normalizeIssue(
    config,
    'apa saja',
    reply(JSON.stringify({ ...JSON.parse(GOOD), subtasks: 'benerin navbar' })),
  );

  assert.ok(issue);
  assert.deepEqual(issue.subtasks, []);
});

test('the subtask list is capped so one runaway reply cannot fan out into Todoist', async () => {
  // Each subtask costs its own API call, so an unbounded list is an unbounded
  // number of writes.
  const many = Array.from({ length: 40 }, (_, i) => `Langkah ${i}`);
  const issue = await normalizeIssue(config, 'apa saja', reply(JSON.stringify({ ...JSON.parse(GOOD), subtasks: many })));

  assert.ok(issue);
  assert.ok(issue.subtasks.length <= MAX_SUBTASKS, `got ${issue.subtasks.length}`);
  assert.equal(issue.subtasks[0], 'Langkah 0', 'the first ones are the ones worth keeping');
});

test('a work item keeps the whole sentence, unlike the title', async () => {
  // Clipping at the title's 100-character ceiling used to cut items mid-word,
  // losing the half that says what to actually do.
  const long = `Perbaiki ${'bagian yang berantakan '.repeat(10)}di halaman pricing`;
  const issue = await normalizeIssue(
    config,
    'apa saja',
    reply(JSON.stringify({ ...JSON.parse(GOOD), subtasks: [long] })),
  );

  assert.ok(issue);
  assert.equal(issue.subtasks[0], long, 'a normal-length item must survive intact');
  assert.ok(long.length > 100, 'the fixture has to be past the old ceiling to prove anything');
});

test('a runaway item is still bounded, so one reply cannot dump a wall of text', async () => {
  const issue = await normalizeIssue(
    config,
    'apa saja',
    reply(JSON.stringify({ ...JSON.parse(GOOD), subtasks: ['y'.repeat(2000)] })),
  );

  assert.ok(issue);
  assert.equal(issue.subtasks[0]!.length, 500);
});

test('a non-URL string in the url field is discarded rather than filed as a link', async () => {
  const issue = await normalizeIssue(
    config,
    'apa saja',
    reply(JSON.stringify({ ...JSON.parse(GOOD), url: 'halaman keranjang' })),
  );

  assert.ok(issue);
  assert.equal(issue.url, null);
});

test('a reply wrapped in a markdown code fence is still parsed', async () => {
  // Gateways that ignore `response_format` habitually fence their JSON.
  const issue = await normalizeIssue(config, 'apa saja', reply(`\`\`\`json\n${GOOD}\n\`\`\``));

  assert.ok(issue);
  assert.equal(issue.title, 'Tombol checkout tidak muncul di mobile');
});

test('an unusable reply is retried once, so one bad generation does not sink the issue', async () => {
  // Observed against a real gateway: long inputs come back with a dropped
  // quote roughly half the time, and the next attempt is usually clean.
  let calls = 0;
  const flaky = (async () => {
    calls++;
    return reply(calls === 1 ? GOOD.slice(0, -20) : GOOD)();
  }) as any;

  const issue = await normalizeIssue(config, 'apa saja', flaky);

  assert.ok(issue, 'the second attempt should have produced an issue');
  assert.equal(calls, 2);
});

test('a reply unusable twice gives up, rather than making the reporter wait through more attempts', async () => {
  let calls = 0;
  const broken = (async () => {
    calls++;
    return reply('maaf, saya tidak bisa')();
  }) as any;

  assert.equal(await normalizeIssue(config, 'apa saja', broken), null);
  assert.equal(calls, 2);
});

test('a refusal is not retried, since a model that refused will refuse again', async () => {
  let calls = 0;
  const refused = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, refusal: 'tidak bisa' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as any;

  assert.equal(await normalizeIssue(config, 'apa saja', refused), null);
  assert.equal(calls, 1);
});

test('an API error is not retried, so a provider outage is not amplified', async () => {
  let calls = 0;
  const failing = (async () => {
    calls++;
    return reply('', 500)();
  }) as any;

  assert.equal(await normalizeIssue(config, 'apa saja', failing), null);
  assert.equal(calls, 1);
});

test('a provider that never answers is abandoned instead of hanging the submission', async () => {
  // Mimics a real fetch: it resolves nothing and only settles when aborted.
  const hangs = ((_url: any, init: any) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    })) as any;

  // AbortSignal.timeout does not hold the event loop open, and with the stub
  // resolving nothing there would be no other work to keep this process alive.
  const keepAlive = setTimeout(() => {}, 5000);
  const started = Date.now();
  const issue = await normalizeIssue(config, 'apa saja', hangs, 60);
  const elapsed = Date.now() - started;
  clearTimeout(keepAlive);

  assert.equal(issue, null);
  assert.ok(elapsed < 2000, `menunggu ${elapsed}ms, budget yang diminta diabaikan`);
});

test('the default budget leaves a slow gateway room to answer', () => {
  // Discord holds a deferred interaction open for 15 minutes, so the old 20s
  // cut off gateway runs that would have succeeded and demoted good reports to
  // raw text. A slower proper ticket beats a fast unusable one.
  assert.equal(TIMEOUT_MS, 60_000);
});
