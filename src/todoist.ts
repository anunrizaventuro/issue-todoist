import { COMMANDS, type CommandName } from './commands.ts';
import { renderDescription, type IssueContext, type NormalizedIssue } from './issue.ts';
import type { DiscordAttachment } from './interaction.ts';

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
  /** Images that could not be uploaded, so the description still links them. */
  unattached: DiscordAttachment[] = context.attachments,
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
      description: renderDescription(issue, context, unattached),
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

/**
 * Todoist's own copy of an uploaded file.
 *
 * Passed straight back into the comments API as `attachment`, so the field
 * names are Todoist's and stay snake_case rather than being renamed.
 *
 * Verified against the live API on 2026-08-20: the upload response carries
 * `resource_type: "image"` and `upload_state`, and Todoist generates its own
 * thumbnails from it — which is what makes the image render on the task rather
 * than sit there as a link.
 */
export interface UploadedFile {
  file_name: string;
  file_size: number;
  file_type: string;
  file_url: string;
  resource_type?: string;
  upload_state?: string;
}

export interface UploadOutcome {
  uploaded: UploadedFile[];
  /** Files that stay behind as Discord links, expiry warning and all. */
  failed: DiscordAttachment[];
}

/** Todoist's free and starter plans cap a single upload here. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Copies Discord's attachments into Todoist.
 *
 * Done before the task is created, not after: the description needs to know
 * which images are safely in Todoist, because a Discord CDN link written into a
 * ticket is dead within about 24 hours and there is no point keeping one for an
 * image Todoist already holds.
 *
 * Never throws. Sequential because these are the reporter's own screenshots —
 * rarely more than one or two, and parallel uploads would only add ways to fail.
 */
export async function uploadAttachments(
  token: string,
  attachments: DiscordAttachment[],
): Promise<UploadOutcome> {
  const uploaded: UploadedFile[] = [];
  const failed: DiscordAttachment[] = [];

  for (const attachment of attachments) {
    // Discord already told us the size, so an oversized file costs no download.
    if (attachment.size > MAX_UPLOAD_BYTES) {
      console.error(`Attachment ${attachment.filename} is ${attachment.size} bytes, over the plan limit`);
      failed.push(attachment);
      continue;
    }

    try {
      const source = await fetch(attachment.url);
      if (!source.ok) throw new Error(`Discord CDN ${source.status}`);

      const form = new FormData();
      form.append(
        'file',
        new File([await source.arrayBuffer()], attachment.filename, {
          type: attachment.content_type ?? 'application/octet-stream',
        }),
      );

      // No Content-Type header: fetch must set the multipart boundary itself.
      const res = await fetch(`${API}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Todoist upload ${res.status}: ${await res.text()}`);

      const file = (await res.json()) as UploadedFile;
      // Anything still in flight would attach as a broken file.
      if (file.upload_state && file.upload_state !== 'completed') {
        throw new Error(`Todoist upload state ${file.upload_state}`);
      }

      uploaded.push(file);
    } catch (cause) {
      console.error(`Attachment ${attachment.filename} failed`, cause);
      failed.push(attachment);
    }
  }

  return { uploaded, failed };
}

/**
 * Attaches uploaded files to the task, one comment each.
 *
 * Comments are how Todoist renders an image on a task; a URL in the description
 * is only ever a link. Returns how many landed — the task already exists, so a
 * refused comment is a missing image, not a lost report.
 *
 * `content` is not optional: verified on 2026-08-20, a comment carrying only an
 * attachment comes back 400 ARGUMENT_MISSING. The filename is the least noisy
 * thing to put there.
 */
export async function attachToTask(
  token: string,
  taskId: string,
  files: UploadedFile[],
): Promise<number> {
  let attached = 0;

  for (const file of files) {
    try {
      const res = await fetch(`${API}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task_id: taskId, content: file.file_name, attachment: file }),
      });
      if (res.ok) attached++;
      else console.error(`Todoist comment ${res.status}: ${await res.text()}`);
    } catch (cause) {
      console.error('Todoist comment failed', cause);
    }
  }

  return attached;
}
