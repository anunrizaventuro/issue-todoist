import { clipTitle, toUrl, type NormalizedIssue } from './issue.ts';
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
 * Per attempt, so a fully unlucky submission waits `MAX_ATTEMPTS` times this.
 *
 * The reporter is waiting on a deferred Discord reply, so fail fast and let the
 * raw-text fallback answer rather than hanging on a slow provider.
 */
export const TIMEOUT_MS = 60_000;

/**
 * Ceiling on subtasks.
 *
 * Each one costs its own Todoist write, so an unbounded list is an unbounded
 * number of calls made while the reporter waits. Eight is well past the point
 * where a Discord report genuinely describes separate pieces of work.
 */
export const MAX_SUBTASKS = 8;

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
    url: {
      type: ['string', 'null'],
      description: 'URL halaman yang bermasalah bila pelapor menyebutkannya. null bila tidak ada.',
    },
    subtasks: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Pekerjaan terpisah yang tersirat di laporan, satu kalimat per item. Array kosong bila laporannya satu pekerjaan saja.',
    },
    needsClarification: { type: 'boolean' },
    clarification: {
      type: ['string', 'null'],
      description: 'Pertanyaan yang perlu dijawab pelapor, null bila tidak ada.',
    },
  },
  required: [
    'title',
    'problem',
    'expected',
    'action',
    'priority',
    'dueString',
    'url',
    'subtasks',
    'needsClarification',
    'clarification',
  ],
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
  `- subtasks: kalau pelapor menyebut lebih dari satu perubahan yang bisa dikerjakan terpisah, pecah jadi satu item per pekerjaan. Beberapa field baru, beberapa halaman, atau perbaikan fungsi plus perubahan tampilan itu pekerjaan terpisah — meski ditulis dalam satu kalimat panjang tanpa tanda baca. Tulis tiap item sebagai perintah singkat. Array kosong hanya bila laporannya benar-benar satu pekerjaan tunggal. Maksimal ${MAX_SUBTASKS} item.`,
  '  Contoh: "tambahkan alamat provinsi sampai desa, kodepos otomatis jadi dropdown, lalu background gradasi"',
  '  -> ["Tambahkan field alamat bertingkat provinsi sampai desa", "Isi kodepos otomatis dari alamat dalam bentuk dropdown", "Terapkan background gradasi pada UI"]',
  '- url diisi hanya dengan alamat yang benar-benar ditulis pelapor (diawali http:// atau https://). Jangan menyusun URL sendiri dari nama halaman.',
  '',
  // Repeated here because `response_format` is honoured unevenly across
  // OpenAI-compatible providers; a provider that ignores it still gets the shape.
  'Balas hanya dengan satu objek JSON sesuai skema ini, tanpa teks lain:',
  JSON.stringify(SCHEMA),
  '',
  // Observed against a gateway that ignores `response_format`: the model
  // sometimes emits the schema above verbatim and *then* the answer, leaving two
  // JSON objects in one reply that no parser can read. Ruling it out costs a
  // line; the alternative is a good report silently filed as raw text.
  'Jangan menyalin skema di atas ke dalam jawaban. Balas objek berisi datanya saja, tanpa kunci "type" atau "properties".',
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

/**
 * Number of attempts, not retries.
 *
 * A gateway that only approximates `response_format` drops a quote or truncates
 * often enough that one bad generation would send a perfectly good report to
 * the raw-text fallback. Two attempts, never more: the reporter is waiting on a
 * deferred reply, and a provider that produced garbage twice is failing for a
 * reason a third call will not fix.
 */
const MAX_ATTEMPTS = 2;

/** A reply that arrived intact but could not be read as an issue. */
const UNUSABLE = Symbol('unusable');

export async function normalizeIssue(
  config: LlmConfig,
  rawInput: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<NormalizedIssue | null> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await attemptNormalize(config, rawInput, fetchImpl, timeoutMs);
    // Only a malformed reply is worth asking again for. An HTTP error, a
    // refusal or a timeout would come back the same and cost the reporter
    // another full wait.
    if (outcome !== UNUSABLE) return outcome;
    if (attempt >= MAX_ATTEMPTS) return null;
  }
}

async function attemptNormalize(
  config: LlmConfig,
  rawInput: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<NormalizedIssue | null | typeof UNUSABLE> {
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
      signal: AbortSignal.timeout(timeoutMs),
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

    if (!message?.content) return null;
    return toIssue(message.content) ?? UNUSABLE;
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
    raw = JSON.parse(unfence(text));
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
    url: toUrl(str(value.url)),
    // Supplied by the reporter, never by the model.
    why: null,
    subtasks: subtasks(value.subtasks),
    needsClarification: value.needsClarification,
    clarification: str(value.clarification),
  };
}

/**
 * Unwraps a ```json fence.
 *
 * A provider that honours `response_format` never adds one; a provider that
 * only approximates it adds one routinely, and the JSON inside is otherwise
 * perfectly good. Anything unfenced is returned untouched.
 */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/** Treats empty strings as absent, so blank sections are omitted downstream. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Anything that is not a usable list of titles becomes no subtasks at all.
 *
 * Most reports have none, so absence is the common case rather than an error —
 * losing a malformed list costs far less than failing the whole normalization.
 */
function subtasks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(str)
    .filter((title): title is string => title !== null)
    .slice(0, MAX_SUBTASKS)
    .map(clipTitle);
}
