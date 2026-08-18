import { InteractionResponseFlags } from 'discord-interactions';
import { truncate } from './followup.ts';
import type { IssueContext } from './issue.ts';
import type { ProcessResult } from './process.ts';

const GREEN = 0x22c55e;
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
  if (context.attachments.length > 0) {
    notes.push(`📎 ${context.attachments.length} gambar (link Discord kedaluwarsa ~24 jam)`);
  }

  return {
    embeds: [
      {
        title: '✅ Issue tercatat',
        description: truncate(result.issue.title, 3800),
        color: GREEN,
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
