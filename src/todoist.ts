import { COMMANDS, type CommandName } from './commands.ts';
import { renderDescription, type IssueContext, type NormalizedIssue } from './issue.ts';

const API = 'https://api.todoist.com/api/v1';

/** Applied when the text was not normalized, so unreviewed issues stay findable. */
export const TRIAGE_LABEL = 'needs-triage';

export interface CreatedTask {
  id: string;
  url: string;
}

/**
 * Creates the task.
 *
 * Verified against the API on 2026-08-18: the response carries no `url` field,
 * so the link is built from the id. The legacy `todoist.com/showTask?id=` form
 * returns 404 for v1 ids.
 */
export async function createTask(
  token: string,
  issue: NormalizedIssue,
  context: IssueContext,
): Promise<CreatedTask> {
  const command: CommandName = context.command;
  const labels = [...COMMANDS[command].labels];
  if (!context.normalized) labels.push(TRIAGE_LABEL);

  const res = await fetch(`${API}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: issue.title,
      description: renderDescription(issue, context),
      project_id: COMMANDS[command].projectId,
      labels,
      priority: issue.priority,
      ...(issue.dueString ? { due_string: issue.dueString, due_lang: 'en' } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Todoist ${res.status}: ${await res.text()}`);
  }

  const task = (await res.json()) as { id: string };
  return { id: task.id, url: taskUrl(task.id) };
}

/**
 * Adds one child task per subtask.
 *
 * Sequential on purpose: Todoist orders children by creation, and the list the
 * model produced is already in the order the work should happen.
 *
 * Never throws. The parent task is saved by the time this runs, so a failed
 * child is a missing detail, not a lost report — the count comes back instead
 * and the reporter is told.
 */
export async function createSubtasks(
  token: string,
  parentId: string,
  titles: string[],
): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;

  for (const content of titles) {
    try {
      const res = await fetch(`${API}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, parent_id: parentId }),
      });

      if (res.ok) {
        created++;
      } else {
        failed++;
        console.error(`Todoist subtask ${res.status}: ${await res.text()}`);
      }
    } catch (cause) {
      failed++;
      console.error('Todoist subtask failed', cause);
    }
  }

  return { created, failed };
}

export function taskUrl(id: string): string {
  return `https://app.todoist.com/app/task/${id}`;
}
