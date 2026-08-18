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
 * Normalization is skipped while ANTHROPIC_API_KEY is unset — the same path the
 * plan reserves for a failed Claude call. Setting the secret switches Claude on
 * without a code change.
 */
export async function processSubmission(
  env: Env,
  context: Omit<IssueContext, 'normalized'>,
): Promise<ProcessResult> {
  // Claude wiring lands here once a key exists; until then the text passes
  // through verbatim rather than being dropped.
  const issue = fromRawInput(context.rawInput);
  const fullContext: IssueContext = { ...context, normalized: false };

  try {
    const task = await createTask(env.TODOIST_API_TOKEN, issue, fullContext);
    return { issue, task, error: null };
  } catch (cause) {
    console.error('Todoist create failed', cause);
    return { issue, task: null, error: String(cause) };
  }
}
