import {
  InteractionResponseFlags,
  InteractionResponseType,
  MessageComponentTypes,
  TextStyleTypes,
} from 'discord-interactions';
import { COMMANDS, type CommandName } from './commands.ts';

/** custom_id of the textarea inside the issue modal. */
export const RAW_INPUT_ID = 'raw_input';

/** custom_id of the optional image field. */
export const ATTACHMENTS_ID = 'attachments';

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
          label: config.fieldLabel,
          description: 'Tulis sebebasnya — sistem yang akan merapikan.',
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
