import { clipTitle, toUrl, type IssueContext, type NormalizedIssue } from './issue.ts';
import type { ProcessResult } from './process.ts';

/**
 * A submission waiting for its reporter to approve it.
 *
 * Carries everything needed to finish the job without the original request:
 * the interaction credentials are stored because the alarm that files an
 * abandoned draft has no request of its own to read them from.
 */
export interface Draft {
  id: string;
  status: DraftStatus;
  issue: NormalizedIssue;
  context: IssueContext;
  /** Only this user may touch the draft. */
  reporterId: string;
  applicationId: string;
  token: string;
  /** Set once filed, so a late click can still point at the task. */
  taskUrl: string | null;
}

/** `filed` and `cancelled` are both terminal. */
export type DraftStatus = 'pending' | 'filed' | 'cancelled';

/**
 * Everything a draft card can correct, as the one edit modal carries it.
 *
 * All four fit in a single modal now that the issue itself is four fields —
 * the five-component cap that once forced a second "Detail AI" modal no longer
 * binds. Editing these touches the model's output directly; there is no longer
 * a separate pass that asks the model to try again.
 */
export interface EditFields {
  title: string;
  url: string | null;
  why: string | null;
  acceptance: string[];
}

export type DraftAction = 'ok' | 'edit' | 'pr' | 'x';

const ACTIONS: readonly DraftAction[] = ['ok', 'edit', 'pr', 'x'];

/**
 * `d:` for components, `dm:` for the modals they open.
 *
 * Two prefixes rather than one because a button click and a modal submit arrive
 * as different interaction types and must not be mistaken for each other. With
 * a UUID the whole thing is about 45 characters, well under Discord's 100.
 */
export function draftCustomId(action: DraftAction, id: string, modal = false): string {
  return `${modal ? 'dm' : 'd'}:${action}:${id}`;
}

export function parseDraftCustomId(
  customId: string | undefined,
): { action: DraftAction; id: string; modal: boolean } | null {
  const parts = customId?.split(':');
  if (!parts || parts.length !== 3) return null;

  const [prefix, action, id] = parts as [string, DraftAction, string];
  if (prefix !== 'd' && prefix !== 'dm') return null;
  if (!ACTIONS.includes(action) || !id) return null;

  return { action, id, modal: prefix === 'dm' };
}

/**
 * Moves a draft to a terminal status, or refuses.
 *
 * The refusal is the whole point: a click and the alarm can reach the same
 * draft, and only one of them may produce a Todoist task. Durable Objects run
 * one request at a time per object, so checking here is enough — no lock needed.
 */
export function claim(draft: Draft, status: 'filed' | 'cancelled'): Draft | null {
  return draft.status === 'pending' ? { ...draft, status } : null;
}

/** Overwrites every field the reporter is allowed to correct. */
export function applyEdit(draft: Draft, fields: EditFields): Draft {
  return {
    ...draft,
    issue: {
      ...draft.issue,
      title: clipTitle(fields.title),
      // A reporter can type anything into the form, and a non-link rendered as a
      // URL is a dead link in the ticket.
      url: toUrl(fields.url),
      why: fields.why,
      acceptance: fields.acceptance,
    },
  };
}

export function applyPriority(draft: Draft, priority: number): Draft {
  const valid = priority === 2 || priority === 3 || priority === 4 ? priority : 1;
  return { ...draft, issue: { ...draft.issue, priority: valid } };
}

/** Ephemeral messages are private already; this guards a leaked custom_id. */
export function isReporter(draft: Draft, userId: string | undefined): boolean {
  return userId !== undefined && userId === draft.reporterId;
}

/**
 * What the handler needs from a draft object.
 *
 * Declared structurally so handler.ts stays importable from plain Node tests —
 * the real implementation sits behind a Workers-only import.
 */
export interface DraftStub {
  start(draft: Draft, windowMs: number): Promise<void>;
  read(): Promise<Draft | null>;
  edit(fields: EditFields): Promise<Draft | null>;
  priority(value: number): Promise<Draft | null>;
  approve(): Promise<ProcessResult | 'closed'>;
  cancel(): Promise<Draft | null>;
}

export interface DraftBinding {
  idFromName(name: string): unknown;
  get(id: unknown): DraftStub;
}

/** One object per draft, named by its id so a button click can find it again. */
export function openDraft(env: { DRAFTS: DraftBinding }, id: string): DraftStub {
  return env.DRAFTS.get(env.DRAFTS.idFromName(id));
}

/**
 * Minutes before an untouched draft files itself.
 *
 * Never past 14: the Discord interaction token dies at 15 minutes, and after
 * that the alarm could no longer replace the draft card with the result —
 * leaving the reporter looking at buttons that no longer do anything.
 */
export function reviewTimeoutMinutes(env: { REVIEW_TIMEOUT_MINUTES?: string }): number {
  const parsed = Number(env.REVIEW_TIMEOUT_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 14) : 10;
}
