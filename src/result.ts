import { InteractionResponseFlags } from 'discord-interactions';
import { truncate } from './followup.ts';
import type { IssueContext } from './issue.ts';
import type { ProcessResult } from './process.ts';

const GREEN = 0x22c55e;
const AMBER = 0xf59e0b;
const RED = 0xef4444;

/**
 * The message that replaces the "thinking..." placeholder.
 *
 * When Todoist rejects the task the user still gets their full text back, so a
 * failure never costs them what they wrote.
 *
 * Shrinks to a bare receipt when the filing was clean, because `announcementMessage`
 * already told the channel — including the reporter — the title, the count and
 * the link. It grows back to the full card the moment there is something only
 * the reporter should read.
 */
export function resultMessage(
  result: ProcessResult,
  context: Omit<IssueContext, 'normalized'>,
): Record<string, unknown> {
  if (!result.task) {
    return {
      embeds: [
        {
          title: '❌ Gagal menyimpan ke Todoist',
          description: truncate(
            `Tulisanmu tidak hilang — silakan salin dari sini:\n\n\`\`\`\n${context.rawInput}\n\`\`\``,
            3800,
          ),
          color: RED,
        },
      ],
      flags: InteractionResponseFlags.EPHEMERAL,
    };
  }

  // Nothing here the announcement does not already say, so the reporter gets a
  // receipt rather than a second copy of it. One report, one message to read.
  if (!warnsReporter(result)) {
    return {
      embeds: [{ title: '✅ Tercatat', color: GREEN }],
      flags: InteractionResponseFlags.EPHEMERAL,
    };
  }

  const notes: string[] = [];
  if (result.subtasksCreated > 0) {
    notes.push(`☑️ ${result.subtasksCreated} sub-task`);
  }
  if (result.subtasksFailed > 0) {
    // The task is already filed, so this is the only place the reporter finds out.
    notes.push(`⚠️ ${result.subtasksFailed} sub-task gagal dibuat`);
  }
  if (result.attachmentsUploaded > 0) {
    notes.push(`🖼️ ${result.attachmentsUploaded} gambar terlampir`);
  }
  if (result.attachmentsFailed > 0) {
    // The task is already filed, so this is the only place the reporter finds out.
    notes.push(`⚠️ ${result.attachmentsFailed} gambar gagal diunggah (maks 5 MB)`);
  }

  // Filed either way, so this is a warning rather than a failure — but saying
  // nothing is what makes a timed-out provider look like a provider that was
  // never wired up at all. The reporter is the one who can judge whether the
  // raw text needs a second pass, and only if they are told.
  const tidied = result.normalized;

  return {
    embeds: [
      {
        title: tidied ? '✅ Issue tercatat' : '⚠️ Tercatat, tapi belum dirapikan AI',
        description: truncate(
          tidied
            ? result.issue.title
            : `${result.issue.title}\n\nTulisanmu masuk apa adanya dan diberi label \`needs-triage\`.`,
          3800,
        ),
        color: tidied ? GREEN : AMBER,
        ...(notes.length > 0 ? { footer: { text: notes.join(' · ') } } : {}),
      },
    ],
    // Absent when Todoist rejected the task: there is nothing to open.
    ...(result.task ? { components: [todoistButton(result.task.url)] } : {}),
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}

/**
 * Whether the reporter's own card says anything the public note does not.
 *
 * Every one of these is addressed to the person who wrote the report and to
 * nobody else: that the model never ran, that a child task or an image did not
 * make it. The announcement deliberately carries none of them, so while one is
 * true the card is the only copy and has to stay.
 */
function warnsReporter(result: ProcessResult): boolean {
  return (
    !result.task ||
    !result.normalized ||
    result.subtasksFailed > 0 ||
    result.attachmentsFailed > 0
  );
}

/**
 * A link to the filed task, as an Action Row ready to drop into a message.
 *
 * Whoever opens it needs access to the project behind TODOIST_API_TOKEN; anyone
 * else lands on "task not found". That is the accepted cost of letting the
 * people who do have access get there in one click.
 */
export function todoistButton(url: string): Record<string, unknown> {
  return {
    type: 1, // Action Row — still the correct container for buttons in messages.
    components: [{ type: 2, style: 5, label: 'Buka di Todoist', url }],
  };
}

/**
 * The public note that tells the channel an issue was filed.
 *
 * Separate from `resultMessage` because the two answer different people: that
 * one confirms to the reporter what happened to their text, this one tells
 * everyone else that the work now exists. Only the typed title travels — the
 * raw description is whatever someone poured into a textarea, and this message
 * is read by the whole channel.
 */
export function announcementMessage(
  result: ProcessResult,
  context: Omit<IssueContext, 'normalized'>,
): Record<string, unknown> {
  const notes: string[] = [];
  // Two people are involved when someone files another person's message, and
  // crediting only one of them misreads who reported what.
  if (context.filedBy) notes.push(`dilaporkan oleh ${context.filedBy}`);
  if (result.subtasksCreated > 0) notes.push(`☑️ ${result.subtasksCreated} sub-task`);

  return {
    embeds: [
      {
        title: `📝 Issue baru dari ${context.author}`,
        description: truncate(result.issue.title, 3800),
        color: GREEN,
        ...(notes.length > 0 ? { footer: { text: notes.join(' · ') } } : {}),
      },
    ],
    // No ephemeral flag: that absence is the entire feature.
    ...(result.task ? { components: [todoistButton(result.task.url)] } : {}),
  };
}
