import { configFromEnv, normalizeIssue } from './llm.ts';
import { clipTitle, fromRawInput, toUrl, type IssueContext, type NormalizedIssue } from './issue.ts';
import {
  attachToTask,
  createSubtasks,
  createTask,
  uploadAttachments,
  type CreatedTask,
} from './todoist.ts';
import type { Env } from './env.ts';

export interface ProcessResult {
  issue: NormalizedIssue;
  task: CreatedTask | null;
  /** Set when the task could not be saved, so the user still gets their text back. */
  error: string | null;
  /** False when the LLM never ran or failed, and the text was filed verbatim. */
  normalized: boolean;
  subtasksCreated: number;
  /** Non-zero means the task exists but is missing some of its children. */
  subtasksFailed: number;
  /** Images now held by Todoist and shown on the task itself. */
  attachmentsUploaded: number;
  /** Images that stayed behind as Discord links, expiry warning and all. */
  attachmentsFailed: number;
}

/**
 * Turns raw input into a structured issue, without writing anything.
 *
 * Split from filing because the reporter reviews the result before it is saved,
 * and because the alarm that files an abandoned draft must not pay for a second
 * normalization.
 *
 * Best-effort by design: with no provider configured, or when the call fails,
 * the text passes through verbatim and `normalized` comes back false. Losing the
 * report is never an acceptable outcome.
 */
export async function normalizeSubmission(
  env: Env,
  context: Omit<IssueContext, 'normalized'>,
): Promise<{ issue: NormalizedIssue; context: IssueContext }> {
  const config = configFromEnv(env);
  const normalized = config ? await normalizeIssue(config, context.rawInput) : null;
  const base = normalized ?? fromRawInput(context.rawInput);

  return {
    // What the reporter typed into the form beats what the model read out of the
    // prose, and survives even when no model ran.
    issue: {
      ...base,
      title: context.typedTitle ? clipTitle(context.typedTitle) : base.title,
      url: toUrl(context.pageUrl) ?? base.url,
    },
    context: { ...context, normalized: normalized !== null },
  };
}

/**
 * Writes the issue to Todoist.
 *
 * A rejected write comes back as an error the caller can show rather than an
 * exception: a rough task the reporter can still read beats no task at all.
 */
export async function fileIssue(
  env: Env,
  issue: NormalizedIssue,
  context: IssueContext,
  extraLabels: string[] = [],
): Promise<ProcessResult> {
  // Uploaded before the task is created: the description decides whether to
  // write a Discord link based on what Todoist already holds, and a Discord CDN
  // link in a ticket is dead within about 24 hours.
  const images = context.attachments.length
    ? await uploadAttachments(env.TODOIST_API_TOKEN, context.attachments)
    : { uploaded: [], failed: [] };

  try {
    const task = await createTask(env.TODOIST_API_TOKEN, issue, context, images.failed, extraLabels);
    const subtasks = issue.subtasks.length
      ? await createSubtasks(env.TODOIST_API_TOKEN, task.id, issue.subtasks)
      : { created: 0, failed: 0 };
    const attached = images.uploaded.length
      ? await attachToTask(env.TODOIST_API_TOKEN, task.id, images.uploaded)
      : 0;

    return {
      issue,
      task,
      error: null,
      normalized: context.normalized,
      subtasksCreated: subtasks.created,
      subtasksFailed: subtasks.failed,
      attachmentsUploaded: attached,
      // An upload that landed but could not be commented is still a missing image.
      attachmentsFailed: images.failed.length + (images.uploaded.length - attached),
    };
  } catch (cause) {
    console.error('Todoist create failed', cause);
    return {
      issue,
      task: null,
      error: String(cause),
      normalized: context.normalized,
      subtasksCreated: 0,
      subtasksFailed: 0,
      attachmentsUploaded: 0,
      attachmentsFailed: context.attachments.length,
    };
  }
}
