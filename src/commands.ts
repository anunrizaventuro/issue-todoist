/**
 * Every slash command and the wording Discord shows for it.
 *
 * Adding `/bug`, `/design`, ... means adding an entry here and re-running
 * `npm run register`. Where an issue lands is not decided here: that follows
 * the channel it was filed in, via the map in config.ts.
 */
export interface CommandConfig {
  /** Labels applied to every task from this command. */
  labels: string[];
  /** Modal heading. Discord caps this at 45 characters. */
  modalTitle: string;
  /**
   * Text above the textarea. Discord caps this at 45 characters.
   *
   * It stands alone — the modal deliberately carries no sub-line under any
   * field — so this has to say what belongs in the box by itself.
   */
  fieldLabel: string;
  /**
   * Greyed-out hint inside the textarea. Discord caps this at 100 characters.
   *
   * This is where the sub-line went, so it tells the reporter what to do
   * rather than showing them a filled-in example: sample text reads as
   * something already written and gets skimmed past.
   */
  placeholder: string;
  /** Shown in Discord's command picker. */
  description: string;
}

export const COMMANDS = {
  issue: {
    labels: ['discord'],
    modalTitle: 'Buat Issue',
    // Acceptance rather than Deskripsi: what "beres" looks like is the one
    // thing only the reporter can say, and it is what the model turns into
    // the checklist on the task.
    fieldLabel: 'Acceptance',
    placeholder: 'Tulis kondisi yang bikin issue ini dianggap beres — sebebasnya, nanti dirapikan',
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
