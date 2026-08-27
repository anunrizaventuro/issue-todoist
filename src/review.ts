import { InteractionResponseFlags } from 'discord-interactions';
import { draftCustomId, type Draft } from './draft.ts';
import { truncate } from './followup.ts';
import { todoistButton } from './result.ts';

const BLUE = 0x3b82f6;
const AMBER = 0xf59e0b;
const GREY = 0x6b7280;

/** Todoist's scale, labelled the way the Todoist UI labels it. */
const PRIORITIES = [
  { value: '4', label: 'p1 — mendesak' },
  { value: '3', label: 'p2 — tinggi' },
  { value: '2', label: 'p3 — sedang' },
  { value: '1', label: 'p4 — biasa' },
];

/**
 * The draft the reporter approves.
 *
 * Shows everything that would be filed rather than a summary: approving
 * something you were not shown is not review, and the fields the model invents
 * are exactly the ones worth checking.
 */
export function reviewMessage(draft: Draft, minutes: number): Record<string, unknown> {
  const { issue, context } = draft;
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (issue.url) fields.push({ name: 'Halaman', value: issue.url });
  if (issue.why) fields.push({ name: 'Kenapa penting', value: truncate(issue.why, 1000) });
  if (context.attachments.length > 0) {
    fields.push({ name: 'Gambar', value: `${context.attachments.length} file`, inline: true });
  }
  // A draft stored before this field existed deserialises without it.
  const subtasks = issue.subtasks ?? [];
  if (subtasks.length > 0) {
    fields.push({ name: 'Sub-task', value: subtasks.map((s) => `• ${s}`).join('\n') });
  }

  return {
    embeds: [
      {
        title: `${context.normalized ? '📝' : '⚠️'} ${truncate(issue.title, 240)}`,
        description: context.normalized
          ? 'Cek dulu sebelum masuk Todoist.'
          : 'AI tidak sempat merapikan ini — tulisanmu apa adanya. Cek dulu sebelum masuk Todoist.',
        color: context.normalized ? BLUE : AMBER,
        fields,
        footer: { text: `⏱️ Otomatis masuk dalam ${minutes} menit kalau didiamkan` },
      },
    ],
    components: [
      {
        type: 1, // Action Row — still the correct container for buttons in messages.
        components: [
          { type: 2, style: 3, label: 'Approve', custom_id: draftCustomId('ok', draft.id) },
          { type: 2, style: 2, label: 'Edit', custom_id: draftCustomId('edit', draft.id) },
          { type: 2, style: 4, label: 'Batal', custom_id: draftCustomId('x', draft.id) },
        ],
      },
      {
        type: 1,
        components: [
          {
            // String Select. Priority has no room left in the modal, and it is
            // the field the model gets wrong most often.
            type: 3,
            custom_id: draftCustomId('pr', draft.id),
            placeholder: 'Prioritas',
            options: PRIORITIES.map((p) => ({
              ...p,
              default: Number(p.value) === issue.priority,
            })),
          },
        ],
      },
    ],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}

/**
 * Shown the instant Approve is pressed, while Todoist is being written.
 *
 * Discord renders a deferred acknowledgement as no change whatsoever, so the
 * card used to sit there with its buttons live and nothing to say it was
 * working — and people pressed Approve again. Replacing the card outright is
 * what makes the wait visible, and dropping the buttons is what makes the
 * second press impossible rather than merely harmless.
 */
export function savingMessage(draft: Draft): Record<string, unknown> {
  return {
    embeds: [
      {
        title: `⏳ Menyimpan ke Todoist…`,
        description: truncate(draft.issue.title, 3800),
        color: GREY,
      },
    ],
    components: [],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}

/** Shown when a click lands on a draft that is already finished. */
export function closedMessage(draft: Draft): Record<string, unknown> {
  const cancelled = draft.status === 'cancelled';
  return {
    embeds: [
      {
        title: cancelled ? '🗑️ Draft ini sudah dibatalkan' : '✅ Draft ini sudah masuk Todoist',
        description: draft.taskUrl
          ? 'Task-nya sudah dibuat.'
          : 'Tidak ada lagi yang bisa dilakukan di sini.',
        color: GREY,
      },
    ],
    // The draft's own actions are gone — they would act on something already
    // filed — but the link still leads somewhere, so it stays.
    components: draft.taskUrl ? [todoistButton(draft.taskUrl)] : [],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}

/** Cancelling must not cost the reporter what they wrote. */
export function cancelledMessage(draft: Draft): Record<string, unknown> {
  return {
    embeds: [
      {
        title: '🗑️ Dibatalkan — tidak masuk Todoist',
        description: truncate(
          `Tulisanmu tidak hilang — silakan salin dari sini:\n\n\`\`\`\n${draft.context.rawInput}\n\`\`\``,
          3800,
        ),
        color: GREY,
      },
    ],
    components: [],
    flags: InteractionResponseFlags.EPHEMERAL,
  };
}
