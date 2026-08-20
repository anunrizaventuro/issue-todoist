import { applyEdit, applyPriority, claim, type Draft, type EditFields } from './draft.ts';
import { editOriginal } from './followup.ts';
import { fileIssue, type ProcessResult } from './process.ts';
import { resultMessage } from './result.ts';
import { REVIEW_LABEL } from './todoist.ts';
import type { Env } from './env.ts';

const DRAFT = 'draft';
const WINDOW = 'window';
const ATTEMPTS = 'attempts';

/** Tries for an alarm that cannot reach Todoist, then it gives up and logs. */
const MAX_ALARM_ATTEMPTS = 3;
const RETRY_MS = 60_000;

/** The slice of Durable Object storage this needs. Narrow so tests can fake it. */
export interface DraftStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/**
 * One submission waiting for its reporter.
 *
 * Durable Objects process one request at a time per object, which is the whole
 * reason a draft lives in one rather than in KV: a click arriving as the alarm
 * fires cannot produce two Todoist tasks, with no locking of our own.
 *
 * All of the logic and none of the runtime lives here, so it can be tested
 * under plain Node — the same split as handler.ts and index.ts.
 */
export class DraftCore {
  // Written out rather than declared as constructor parameter properties:
  // Node's type-stripping runs the test suite and does not support those.
  readonly storage: DraftStorage;
  readonly env: Env;

  constructor(storage: DraftStorage, env: Env) {
    this.storage = storage;
    this.env = env;
  }

  async start(draft: Draft, windowMs: number): Promise<void> {
    await this.storage.put(DRAFT, draft);
    await this.storage.put(WINDOW, windowMs);
    await this.storage.put(ATTEMPTS, 0);
    await this.storage.setAlarm(Date.now() + windowMs);
  }

  async read(): Promise<Draft | null> {
    return (await this.storage.get<Draft>(DRAFT)) ?? null;
  }

  async edit(fields: EditFields): Promise<Draft | null> {
    return this.mutate((draft) => applyEdit(draft, fields));
  }

  async priority(value: number): Promise<Draft | null> {
    return this.mutate((draft) => applyPriority(draft, value));
  }

  /** Returns 'closed' when the draft was already finished by someone else. */
  async approve(): Promise<ProcessResult | 'closed'> {
    const draft = await this.read();
    const claimed = draft ? claim(draft, 'filed') : null;
    if (!draft || !claimed) return 'closed';

    // Claimed before the write, so a second click bounces off immediately
    // rather than racing the Todoist call.
    await this.storage.put(DRAFT, claimed);
    await this.storage.deleteAlarm();

    const result = await fileIssue(this.env, claimed.issue, claimed.context);
    if (result.task) {
      await this.storage.put(DRAFT, { ...claimed, taskUrl: result.task.url });
    } else {
      // Todoist refused. Hand the draft back rather than stranding the
      // reporter's text behind a terminal status they cannot undo.
      await this.storage.put(DRAFT, draft);
      await this.storage.setAlarm(Date.now() + RETRY_MS);
    }
    return result;
  }

  async cancel(): Promise<Draft | null> {
    const draft = await this.read();
    const claimed = draft ? claim(draft, 'cancelled') : null;
    if (!claimed) return null;

    await this.storage.put(DRAFT, claimed);
    await this.storage.deleteAlarm();
    return claimed;
  }

  /**
   * Nobody approved in time, so the report is filed anyway.
   *
   * Losing what someone wrote because they got distracted is the one outcome
   * this project refuses; the label is how triage finds these afterwards.
   */
  async fire(): Promise<void> {
    const attempts = (await this.storage.get<number>(ATTEMPTS)) ?? 0;
    if (attempts >= MAX_ALARM_ATTEMPTS) {
      console.error(`Draft alarm gave up after ${attempts} attempts`);
      return;
    }

    const draft = await this.read();
    const claimed = draft ? claim(draft, 'filed') : null;
    if (!draft || !claimed) return;

    const result = await fileIssue(this.env, draft.issue, draft.context, [REVIEW_LABEL]);

    if (!result.task) {
      const next = attempts + 1;
      await this.storage.put(ATTEMPTS, next);
      if (next < MAX_ALARM_ATTEMPTS) await this.storage.setAlarm(Date.now() + RETRY_MS);
      else console.error(`Draft ${draft.id} could not be filed after ${next} attempts`);
      return;
    }

    await this.storage.put(DRAFT, { ...claimed, taskUrl: result.task.url });
    // Best effort: past minute 15 the token is dead and there is nothing to edit.
    await editOriginal(draft.applicationId, draft.token, resultMessage(result, draft.context));
  }

  /** Editing means someone is still working, so the window starts over. */
  private async mutate(change: (draft: Draft) => Draft): Promise<Draft | null> {
    const draft = await this.read();
    if (!draft || draft.status !== 'pending') return null;

    const next = change(draft);
    await this.storage.put(DRAFT, next);
    const windowMs = (await this.storage.get<number>(WINDOW)) ?? 10 * 60_000;
    await this.storage.setAlarm(Date.now() + windowMs);
    return next;
  }
}
