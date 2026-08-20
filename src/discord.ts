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

/** custom_id of the expected-behaviour field in the edit modal. */
export const EXPECTED_ID = 'expected';

/** custom_id of the steps field in the edit modal. */
export const ACTION_ID = 'action';

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
            required: true,
            min_length: 10,
            max_length: 4000,
            placeholder: config.placeholder,
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
 * Correcting the model's output directly, without paying for another call.
 *
 * Five fields is Discord's ceiling and it is exactly spent. Priority moved to a
 * dropdown on the card; the due date is left to Todoist, since the model only
 * fills it in when the reporter actually named one.
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
        textField(RAW_INPUT_ID, 'Deskripsi', issue.problem, TextStyleTypes.PARAGRAPH, {
          required: true,
          max_length: 4000,
        }),
        textField(EXPECTED_ID, 'Harapan', issue.expected, TextStyleTypes.PARAGRAPH, {
          max_length: 1000,
        }),
        textField(ACTION_ID, 'Langkah', issue.action, TextStyleTypes.PARAGRAPH, {
          max_length: 1000,
        }),
      ],
    },
  };
}

/** Hands back what the reporter originally wrote, for the model to try again. */
export function buildRewriteModal(draft: Draft) {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: draftCustomId('rw', draft.id, true),
      title: 'Tulis ulang',
      components: [
        textField(RAW_INPUT_ID, 'Tulisan aslimu', draft.context.rawInput, TextStyleTypes.PARAGRAPH, {
          required: true,
          min_length: 10,
          max_length: 4000,
        }),
      ],
    },
  };
}
