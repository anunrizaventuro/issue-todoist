import { clipTitle, toUrl, type IssueContext, type NormalizedIssue } from './issue.ts';

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
 * What the edit modal can carry.
 *
 * Five fields is Discord's ceiling and it is exactly spent: priority moved to a
 * dropdown on the card, and the due date is left to Todoist.
 */
export interface EditFields {
  title: string;
  url: string | null;
  problem: string;
  expected: string | null;
  action: string | null;
}

export type DraftAction = 'ok' | 'edit' | 'rw' | 'pr' | 'x';

const ACTIONS: readonly DraftAction[] = ['ok', 'edit', 'rw', 'pr', 'x'];

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

/** Overwrites what the modal carried, leaving priority, due and subtasks alone. */
export function applyEdit(draft: Draft, fields: EditFields): Draft {
  return {
    ...draft,
    issue: {
      ...draft.issue,
      title: clipTitle(fields.title),
      // A reporter can type anything into the form, and a non-link rendered as a
      // URL is a dead link in the ticket.
      url: toUrl(fields.url),
      problem: fields.problem,
      expected: fields.expected,
      action: fields.action,
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
