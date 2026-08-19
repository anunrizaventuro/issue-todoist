import { configFromEnv, normalizeIssue } from './llm.ts';
import { fromRawInput, toUrl, type IssueContext, type NormalizedIssue } from './issue.ts';
import { createSubtasks, createTask, type CreatedTask } from './todoist.ts';
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
}

/**
 * Turns a submission into a Todoist task.
 *
 * Normalization is best-effort: with no provider configured, or when the call
 * fails, the text passes through verbatim and the task is labelled for triage
 * instead. Losing the report is never an acceptable outcome — a rough task the
 * reporter can still read beats no task at all.
 */
export async function processSubmission(
  env: Env,
  context: Omit<IssueContext, 'normalized'>,
): Promise<ProcessResult> {
  const config = configFromEnv(env);
  const normalized = config ? await normalizeIssue(config, context.rawInput) : null;

  const base = normalized ?? fromRawInput(context.rawInput);
  // What the reporter typed into the form beats what the model read out of the
  // prose, and survives even when no model ran.
  const issue: NormalizedIssue = { ...base, url: toUrl(context.pageUrl) ?? base.url };
  const fullContext: IssueContext = { ...context, normalized: normalized !== null };

  try {
    const task = await createTask(env.TODOIST_API_TOKEN, issue, fullContext);
    const subtasks = issue.subtasks.length
      ? await createSubtasks(env.TODOIST_API_TOKEN, task.id, issue.subtasks)
      : { created: 0, failed: 0 };

    return {
      issue,
      task,
      error: null,
      normalized: fullContext.normalized,
      subtasksCreated: subtasks.created,
      subtasksFailed: subtasks.failed,
    };
  } catch (cause) {
    console.error('Todoist create failed', cause);
    return {
      issue,
      task: null,
      error: String(cause),
      normalized: fullContext.normalized,
      subtasksCreated: 0,
      subtasksFailed: 0,
    };
  }
}
