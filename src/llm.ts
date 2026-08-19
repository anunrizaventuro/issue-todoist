import { clipTitle, type NormalizedIssue } from './issue.ts';
import type { Env } from './env.ts';

/**
 * Rewrites a messy Discord message into a structured issue.
 *
 * Talks to any OpenAI-compatible `/chat/completions` endpoint — OpenRouter,
 * OpenAI, Groq, DeepSeek, Ollama — so switching provider is a config change,
 * never a code change.
 *
 * Every failure path returns null rather than throwing: a submission the model
 * cannot process must still reach Todoist as raw text, so the reporter never
 * loses what they wrote. The caller falls back to `fromRawInput`.
 */

export interface LlmConfig {
  /** Without a trailing slash by the time it is used; see `configFromEnv`. */
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * The reporter is waiting on a deferred Discord reply, so fail fast and let the
 * raw-text fallback answer rather than hanging on a slow provider.
 */
const TIMEOUT_MS = 20_000;

/**
 * Mirrors NormalizedIssue. `additionalProperties: false` plus a full `required`
 * list is what `strict: true` demands, and what makes the structured output
 * reliable enough to trust downstream.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Ringkasan satu baris, maksimal 100 karakter.' },
    problem: { type: 'string', description: 'Masalahnya, ditulis ulang dengan jelas.' },
    expected: { type: ['string', 'null'], description: 'Perilaku yang diharapkan, null bila tidak tersirat.' },
    action: { type: ['string', 'null'], description: 'Langkah reproduksi, null bila tidak disebut.' },
    priority: {
      type: 'integer',
      enum: [1, 2, 3, 4],
      description: 'Skala Todoist: 1 = biasa, 4 = mendesak. Pakai 1 kalau ragu.',
    },
    dueString: {
      type: ['string', 'null'],
      description: 'Tenggat dalam bahasa Inggris ("tomorrow", "next monday") atau ISO. null bila tidak disebut.',
    },
    needsClarification: { type: 'boolean' },
    clarification: {
      type: ['string', 'null'],
      description: 'Pertanyaan yang perlu dijawab pelapor, null bila tidak ada.',
    },
  },
  required: ['title', 'problem', 'expected', 'action', 'priority', 'dueString', 'needsClarification', 'clarification'],
  additionalProperties: false,
} as const;

const SYSTEM = [
  'Kamu merapikan laporan issue berbahasa Indonesia dari Discord menjadi tiket yang bisa dikerjakan.',
  '',
  'Aturan:',
  '- Jangan mengarang. Kalau sesuatu tidak disebut pelapor, isi null — jangan ditebak.',
  '- Pertahankan bahasa Indonesia untuk semua teks, kecuali dueString.',
  '- title harus spesifik dan bisa dipindai sekilas, bukan pengulangan seluruh pesan.',
  '- Naikkan priority hanya bila pelapor menyatakan urgensi atau dampaknya jelas luas.',
  '- Set needsClarification hanya bila laporannya benar-benar tidak bisa dikerjakan tanpa jawaban.',
  '',
  // Repeated here because `response_format` is honoured unevenly across
  // OpenAI-compatible providers; a provider that ignores it still gets the shape.
  'Balas hanya dengan satu objek JSON sesuai skema ini, tanpa teks lain:',
  JSON.stringify(SCHEMA),
].join('\n');

/**
 * Reads the provider settings, or null when they are incomplete.
 *
 * All three are needed to make a call, so a half-filled config is treated the
 * same as no config at all: skip normalization rather than fail the submission.
 */
export function configFromEnv(env: Env): LlmConfig | null {
  const baseUrl = env.LLM_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const model = env.LLM_MODEL?.trim() ?? '';
  const apiKey = env.LLM_API_KEY?.trim() ?? '';

  return baseUrl && model && apiKey ? { baseUrl, model, apiKey } : null;
}

export async function normalizeIssue(
  config: LlmConfig,
  rawInput: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedIssue | null> {
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        // Some gateways stream unless told not to, and SSE frames are not JSON.
        stream: false,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: rawInput },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'issue', strict: true, schema: SCHEMA },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error('LLM normalize failed', response.status, await response.text());
      return null;
    }

    const message = (await response.json() as ChatCompletion)?.choices?.[0]?.message;
    if (message?.refusal) {
      console.error('LLM refused to normalize', message.refusal);
      return null;
    }

    return message?.content ? toIssue(message.content) : null;
  } catch (cause) {
    console.error('LLM normalize failed', cause);
    return null;
  }
}

/** Only the fields read above; providers add plenty more that is ignored. */
interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
}

/**
 * Validates before trusting. The schema is enforced provider-side, but not
 * every OpenAI-compatible provider honours `strict`, and a bad value reaching
 * Todoist fails the whole submission.
 */
function toIssue(text: string): NormalizedIssue | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error('LLM returned non-JSON');
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const title = str(value.title);
  const problem = str(value.problem);
  const priority = value.priority;
  if (!title || !problem) return null;
  if (priority !== 1 && priority !== 2 && priority !== 3 && priority !== 4) return null;
  if (typeof value.needsClarification !== 'boolean') return null;

  return {
    title: clipTitle(title),
    problem,
    expected: str(value.expected),
    action: str(value.action),
    priority,
    dueString: str(value.dueString),
    needsClarification: value.needsClarification,
    clarification: str(value.clarification),
  };
}

/** Treats empty strings as absent, so blank sections are omitted downstream. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
