/**
 * Every slash command maps deterministically to one Todoist destination.
 *
 * Adding `/bug`, `/design`, ... means adding an entry here and re-running
 * `npm run register`. The LLM never picks the project — routing is code's job.
 */
export interface CommandConfig {
  /** Todoist project the issue is filed into. */
  projectId: string;
  /** Labels applied to every task from this command. */
  labels: string[];
  /** Modal heading. Discord caps this at 45 characters. */
  modalTitle: string;
  /** Text above the textarea. Discord caps this at 45 characters. */
  fieldLabel: string;
  /** Greyed-out hint inside the textarea. Discord caps this at 100 characters. */
  placeholder: string;
  /** Shown in Discord's command picker. */
  description: string;
}

export const COMMANDS = {
  issue: {
    projectId: '6hHmCp3r5qgFW9Q4',
    labels: ['discord'],
    modalTitle: 'Input Issue',
    fieldLabel: 'Deskripsi',
    placeholder: 'Tulis issue-nya di sini, seberantakan apa pun...',
    description: 'Buat issue baru',
  },
} satisfies Record<string, CommandConfig>;

export type CommandName = keyof typeof COMMANDS;

export function isCommandName(name: string | undefined): name is CommandName {
  return name !== undefined && Object.hasOwn(COMMANDS, name);
}

/**
 * Right-click entry point: "Apps → Buat Issue" on any message.
 *
 * Exists because Discord's modal upload box has no paste support — pasting a
 * screenshot into the channel does, so this turns that message into an issue.
 * Context menu names may use mixed case and spaces, unlike slash commands.
 */
export const MESSAGE_COMMAND_NAME = 'Buat Issue';

/** Context menu issues land in the same place as /issue. */
export const MESSAGE_COMMAND_TARGET: CommandName = 'issue';
