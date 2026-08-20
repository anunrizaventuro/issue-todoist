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
    components: [
      {
        type: 1, // Action Row — still the correct container for buttons in messages.
        components: [
          { type: 2, style: 5, label: 'Buka di Todoist', url: result.task.url },
        ],
      },
    ],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}
