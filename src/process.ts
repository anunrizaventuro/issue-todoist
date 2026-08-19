import { normalizeIssue } from './claude.ts';
import { fromRawInput, type IssueContext, type NormalizedIssue } from './issue.ts';
import { createTask, type CreatedTask } from './todoist.ts';
import type { Env } from './env.ts';

export interface ProcessResult {
  issue: NormalizedIssue;
  task: CreatedTask | null;
  /** Set when the task could not be saved, so the user still gets their text back. */
  error: string | null;
}

/**
 * Turns a submission into a Todoist task.
 *
 * Normalization is best-effort: with no ANTHROPIC_API_KEY, or when the Claude
 * call fails, the text passes through verbatim and the task is labelled for
 * triage instead. Losing the report is never an acceptable outcome — a rough
 * task the reporter can still read beats no task at all.
 */
export async function processSubmission(
  env: Env,
  context: Omit<IssueContext, 'normalized'>,
): Promise<ProcessResult> {
  const normalized = env.ANTHROPIC_API_KEY
    ? await normalizeIssue(env.ANTHROPIC_API_KEY, context.rawInput)
    : null;

  const issue = normalized ?? fromRawInput(context.rawInput);
  const fullContext: IssueContext = { ...context, normalized: normalized !== null };

  try {
    const task = await createTask(env.TODOIST_API_TOKEN, issue, fullContext);
    return { issue, task, error: null };
  } catch (cause) {
    console.error('Todoist create failed', cause);
    return { issue, task: null, error: String(cause) };
  }
}
