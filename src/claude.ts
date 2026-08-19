import Anthropic from '@anthropic-ai/sdk';
import { clipTitle, type NormalizedIssue } from './issue.ts';

/**
 * Rewrites a messy Discord message into a structured issue.
 *
 * Every failure path returns null rather than throwing: a submission that
 * Claude cannot process must still reach Todoist as raw text, so the reporter
 * never loses what they wrote. The caller falls back to `fromRawInput`.
 */

const MODEL = 'claude-opus-5';

/**
 * Mirrors NormalizedIssue. `additionalProperties: false` plus a full `required`
 * list is what makes the structured output reliable enough to trust downstream.
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
].join('\n');

export async function normalizeIssue(
  apiKey: string,
  rawInput: string,
  fetchImpl?: typeof fetch,
): Promise<NormalizedIssue | null> {
  const client = new Anthropic({
    apiKey,
    // The reporter is waiting on a deferred Discord reply, so fail fast and let
    // the raw-text fallback answer rather than retrying into a timeout.
    maxRetries: 1,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: rawInput }],
    });

    if (response.stop_reason === 'refusal') {
      console.error('Claude refused to normalize', response.stop_details);
      return null;
    }

    const text = response.content.find((block) => block.type === 'text')?.text;
    return text ? toIssue(text) : null;
  } catch (cause) {
    console.error('Claude normalize failed', cause);
    return null;
  }
}

/**
 * Validates before trusting. The schema is enforced server-side, but a bad
 * value reaching Todoist fails the whole submission, so it is re-checked here.
 */
function toIssue(text: string): NormalizedIssue | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error('Claude returned non-JSON');
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
