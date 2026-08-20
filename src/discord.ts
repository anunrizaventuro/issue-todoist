import {
  InteractionResponseFlags,
  InteractionResponseType,
  MessageComponentTypes,
  TextStyleTypes,
} from 'discord-interactions';
import { COMMANDS, type CommandName } from './commands.ts';
import { draftCustomId, type Draft } from './draft.ts';

/** custom_id of the title field. */
export const TITLE_ID = 'title';

/** custom_id of the textarea inside the issue modal. */
export const RAW_INPUT_ID = 'raw_input';

/** custom_id of the optional page-URL field. */
export const PAGE_URL_ID = 'page_url';

/** custom_id of the optional image field. */
export const ATTACHMENTS_ID = 'attachments';

/** custom_id of the "why this matters" field. */
export const WHY_ID = 'why';

/** custom_id of the acceptance textarea in the edit modal. */
export const ACCEPTANCE_ID = 'acceptance';

/** Prefix that carries the command name across the modal round-trip. */
export const MODAL_PREFIX = 'issue:';

/** File Upload component. Newer than discord-interactions' enum, so declared here. */
const FILE_UPLOAD = 19;

/** Todoist's free plan caps uploads at 5 MB per file. */
export const MAX_ATTACHMENTS = 4;

/**
 * Builds the popup shown after a slash command.
 *
 * Text inputs and file uploads must each sit inside a Label component —
 * placing them in an Action Row is deprecated for modals, and TextInput's own
 * `label` field is deprecated too.
 *
 * `min_length` is enforced by Discord's client, so a too-short issue is
 * rejected before it ever costs an API call. The server still re-checks it.
 */
export function buildIssueModal(command: CommandName) {
  const config = COMMANDS[command];
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${MODAL_PREFIX}${command}`,
      title: config.modalTitle,
      components: [
        {
          type: MessageComponentTypes.LABEL,
          label: 'Judul',
          description: 'Satu baris yang bisa dipindai sekilas.',
          component: {
            type: MessageComponentTypes.INPUT_TEXT,
            custom_id: TITLE_ID,
            style: TextStyleTypes.SHORT,
            required: true,
            min_length: 5,
            // Todoist truncates past this, and clipTitle enforces the same ceiling.
            max_length: 100,
            placeholder: 'Kodepos tidak terisi otomatis',
          },
        },
        {
          type: MessageComponentTypes.LABEL,
          label: 'Halaman terkait (opsional)',
          description: 'URL halaman tempat issue-nya muncul.',
          component: {
            type: MessageComponentTypes.INPUT_TEXT,
            custom_id: PAGE_URL_ID,
            style: TextStyleTypes.SHORT,
            required: false,
            max_length: 500,
            placeholder: 'https://...',
          },
        },
        {
          type: MessageComponentTypes.LABEL,
          label: config.fieldLabel,
          description: 'Kenapa ini masalah? Tulis sebebasnya — sistem yang merapikan.',
          component: {
            type: MessageComponentTypes.INPUT_TEXT,
            custom_id: RAW_INPUT_ID,
            style: TextStyleTypes.PARAGRAPH,
            // Only the title is mandatory: a one-line report is still a report,
            // and a required field people have nothing to put in gets filled
            // with noise.
            required: false,
            max_length: 4000,
            placeholder: config.placeholder,
          },
        },
        {
          type: MessageComponentTypes.LABEL,
          label: 'Kenapa ini penting (opsional)',
          description: 'Dampaknya ke siapa, dan seberapa mengganggu.',
          component: {
            type: MessageComponentTypes.INPUT_TEXT,
            custom_id: WHY_ID,
            style: TextStyleTypes.PARAGRAPH,
            required: false,
            max_length: 1000,
            placeholder: 'Pelanggan tidak bisa checkout, jadi order batal.',
          },
        },
        {
          type: MessageComponentTypes.LABEL,
          label: 'Gambar (opsional)',
          description: 'Screenshot sangat membantu. Maksimal 5 MB per file.',
          component: {
            type: FILE_UPLOAD,
            custom_id: ATTACHMENTS_ID,
            // Defaults to true inside modals, which would block text-only issues.
            required: false,
            min_values: 0,
            max_values: MAX_ATTACHMENTS,
          },
        },
      ],
    },
  };
}

/** A message only the invoking user can see. */
export function ephemeral(content: string) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL },
  };
}

/**
 * Acknowledges within Discord's 3-second budget and shows a loading state.
 * The real answer is sent later by editing this response.
 */
export function deferEphemeral() {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: InteractionResponseFlags.EPHEMERAL },
  };
}

function textField(
  customId: string,
  label: string,
  value: string | null,
  style: number,
  extra: Record<string, unknown> = {},
) {
  return {
    type: MessageComponentTypes.LABEL,
    label,
    component: {
      type: MessageComponentTypes.INPUT_TEXT,
      custom_id: customId,
      style,
      required: false,
      value: value ?? '',
      ...extra,
    },
  };
}

/**
 * The whole draft, in one modal.
 *
 * Four fields fit inside Discord's five-component cap, which is what let the
 * old `Edit` / `Detail AI` pair collapse into this. Editing here writes over
 * the model's output directly rather than asking it for another pass.
 */
export function buildEditModal(draft: Draft) {
  const { issue } = draft;
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: draftCustomId('edit', draft.id, true),
      title: 'Perbaiki issue',
      components: [
        textField(TITLE_ID, 'Judul', issue.title, TextStyleTypes.SHORT, {
          required: true,
          max_length: 100,
        }),
        textField(PAGE_URL_ID, 'Halaman', issue.url, TextStyleTypes.SHORT, { max_length: 500 }),
        textField(WHY_ID, 'Kenapa ini penting', issue.why, TextStyleTypes.PARAGRAPH, {
          max_length: 1000,
        }),
        textField(
          ACCEPTANCE_ID,
          'Acceptance (satu per baris)',
          // Drafts stored before this field existed deserialise without it.
          (issue.acceptance ?? []).join('\n'),
          TextStyleTypes.PARAGRAPH,
          { max_length: 2000 },
        ),
      ],
    },
  };
}

/**
 * Splits the acceptance textarea back into items.
 *
 * Blank lines are how people space out a list they are editing, so they are
 * dropped rather than becoming empty child tasks. A leading bullet is what the
 * card showed them, so it is stripped rather than filed as part of the text.
 */
export function parseAcceptance(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);
}
