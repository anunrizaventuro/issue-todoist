import { generateKeyPairSync, sign } from 'node:crypto';
import { CONFIG } from '../src/config.ts';
import type { Env } from '../src/env.ts';

/**
 * The server every payload in the suite pretends to come from.
 *
 * The allowlist lives in config.ts and is no longer injectable, so a test
 * payload without a guild is refused before it reaches what it means to test.
 */
export const GUILD = CONFIG.discord.guildIds[0]!;

// Discord signs `timestamp + rawBody` with Ed25519. Generating our own keypair
// exercises the real verification path without any real credentials.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

export const env: Env = {
  DISCORD_PUBLIC_KEY: Buffer.from(
    publicKey.export({ format: 'jwk' }).x as string,
    'base64url',
  ).toString('hex'),
  // Empty on purpose: these tests exercise the raw-text path. The provider call
  // itself is covered in llm.test.ts with an injected fetch.
  LLM_BASE_URL: '',
  LLM_MODEL: '',
  LLM_API_KEY: '',
  TODOIST_API_TOKEN: 'unused',
  // Replaced per test by anything exercising the draft flow.
  DRAFTS: {
    idFromName: () => ({}),
    get: () => { throw new Error('no draft binding in this test'); },
  },
  REVIEW_TIMEOUT_MINUTES: '10',
};

export const noopWaitUntil = () => {};

export function request(body: string, headers: Record<string, string>): Request {
  return new Request('https://example.com/', { method: 'POST', body, headers });
}

/** Wraps a payload in headers Discord would send for it. */
export function signed(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const timestamp = '1700000000';
  return request(body, {
    'X-Signature-Ed25519': sign(null, Buffer.from(timestamp + body), privateKey).toString('hex'),
    'X-Signature-Timestamp': timestamp,
  });
}

export interface OutboundCall {
  url: string;
  body: any;
}

/**
 * Intercepts every outbound request for the duration of a test file.
 *
 * The work scheduled through `waitUntil` runs for real in these tests, so
 * without this the suite calls Todoist and Discord on every run — which is both
 * network-dependent and noisy with 401s from the placeholder token.
 */
export function captureFetch(response: unknown = { id: '42' }) {
  const sent: OutboundCall[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: any, init: any) => {
    sent.push({
      url: String(input?.url ?? input),
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  return { sent, restore: () => { globalThis.fetch = real; } };
}

/**
 * Stands in for Durable Object storage.
 *
 * Only the four methods DraftCore uses, so the fake cannot drift far from what
 * the real storage does.
 */
export function fakeState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    alarmAt: () => alarm,
    storage: {
      get: async <T,>(key: string) => store.get(key) as T | undefined,
      put: async (key: string, value: unknown) => void store.set(key, value),
      setAlarm: async (at: number) => void (alarm = at),
      deleteAlarm: async () => void (alarm = null),
    },
  };
}

/**
 * An in-memory stand-in for the draft binding.
 *
 * Records the drafts that were started so a test can assert on what the
 * reporter would be shown, without reaching for a Durable Object.
 */
export function memoryDrafts() {
  const started: any[] = [];
  let current: any = null;

  const stub = {
    start: async (draft: any) => { current = draft; started.push(draft); },
    read: async () => current,
    edit: async (fields: any) => {
      current = { ...current, issue: { ...current.issue, ...fields } };
      return current;
    },
    editAi: async (fields: any) => {
      current = { ...current, issue: { ...current.issue, ...fields } };
      return current;
    },
    rewrite: async (issue: any, rawInput: string) => {
      current = { ...current, issue, context: { ...current.context, rawInput } };
      return current;
    },
    priority: async (value: number) => {
      current = { ...current, issue: { ...current.issue, priority: value } };
      return current;
    },
    approve: async () => ({
      issue: current.issue,
      task: { id: '42', url: 'https://app.todoist.com/app/task/42' },
      error: null,
      normalized: current.context.normalized,
      subtasksCreated: 0,
      subtasksFailed: 0,
      attachmentsUploaded: 0,
      attachmentsFailed: 0,
    }),
    cancel: async () => { current = { ...current, status: 'cancelled' }; return current; },
  };

  return {
    started,
    set: (draft: any) => { current = draft; },
    binding: { idFromName: () => ({}), get: () => stub },
  };
}
