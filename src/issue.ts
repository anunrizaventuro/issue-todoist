import type { CommandName } from './commands.ts';
import type { DiscordAttachment } from './interaction.ts';

/**
 * The structured issue.
 *
 * The LLM produces this once a provider is configured; until then
 * `fromRawInput` produces the same shape from the user's text as-is. Everything
 * downstream (Todoist, the Discord embed) only ever sees this type, so
 * switching the source changes nothing else.
 */
export interface NormalizedIssue {
  title: string;
  /** Todoist scale: 1 = normal ... 4 = urgent. Inverted from p1-p4 in the UI. */
  priority: 1 | 2 | 3 | 4;
  /** Page the issue is about: typed into the form, or found in the text. */
  url: string | null;
  /**
   * Why this matters, in the reporter's own words.
   *
   * Never written by the model — it is the one thing only the person who hit
   * the problem can answer, so rewriting it would be inventing motivation.
   */
  why: string | null;
  /**
   * The work the report asks for, one imperative item each.
   *
   * The model produces these by breaking the reporter's description apart, and
   * Todoist writes them as child tasks so each can be ticked off on its own.
   * Written as commands rather than finished states: these are things nobody
   * has done yet, and phrasing them as done reads as a claim, not a task.
   */
  subtasks: string[];
}

export interface IssueContext {
  command: CommandName;
  rawInput: string;
  author: string;
  /**
   * Discord handle behind `author`, used only to build the reporter label.
   * Null when Discord sent none. Absent entirely on drafts stored before this
   * field existed, so readers must tolerate `undefined` too.
   */
  authorUsername: string | null;
  /** Set only when someone filed another person's message. */
  filedBy: string | null;
  /** Discord handle behind `filedBy`, on the same terms as `authorUsername`. */
  filedByUsername: string | null;
  sourceLink: string | null;
  /**
   * Channel the report was filed in, which decides the Todoist project.
   * Optional because drafts stored before routing existed carry none — those
   * take the default project, same as any unmapped channel.
   */
  channelId?: string | null;
  /** Parent channel when `channelId` is a thread, so a mapped channel covers it. */
  channelParentId?: string | null;
  /** Title typed into the form. Outranks the one the model produced. */
  typedTitle: string | null;
  /** URL typed into the form. Outranks whatever the model found in the text. */
  pageUrl: string | null;
  /** The "kenapa ini penting" field, kept verbatim. */
  why: string | null;
  attachments: DiscordAttachment[];
  /** False when no LLM ran and the text was passed through as-is. */
  normalized: boolean;
}

/** Todoist truncates long titles in list views, so keep them scannable. */
const MAX_TITLE_LENGTH = 100;

/**
 * Passthrough used when no provider is configured, and as the fallback when
 * the LLM call fails. Never invents anything: the title is the user's own first
 * line, and the body is their text verbatim.
 */
export function fromRawInput(rawInput: string): NormalizedIssue {
  return {
    title: firstLine(rawInput),
    priority: 1,
    url: null,
    why: null,
    // Splitting a report into separate pieces of work is the model's whole job,
    // so with no model there is nothing honest to put here. The reporter's text
    // still reaches Todoist as the quote in the footer.
    subtasks: [],
  };
}

function firstLine(text: string): string {
  return clipTitle(text.split('\n').map((l) => l.trim()).find(Boolean) ?? text.trim());
}

/**
 * Keeps only what is actually a link.
 *
 * Guards both ends: a model that answers "halaman keranjang" is describing the
 * page rather than citing it, and a reporter can type anything into the form.
 * Either way a non-link rendered as a URL is a dead link in the ticket.
 */
export function toUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;

  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Shared with the LLM path: the model is told to keep titles short, but a
 * title that slips through long would be truncated by Todoist anyway, and
 * mid-word by default.
 */
export function clipTitle(line: string): string {
  if (line.length <= MAX_TITLE_LENGTH) return line;

  // Prefer cutting at a word boundary over slicing mid-word.
  const clipped = line.slice(0, MAX_TITLE_LENGTH - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * Renders the Todoist description in Markdown.
 *
 * Deliberately thin: the title says what is wrong, the child tasks say what
 * "done" means, and this carries only what neither can hold. Empty sections are
 * omitted entirely rather than rendered as "Harapan: -".
 */
export function renderDescription(
  issue: NormalizedIssue,
  context: IssueContext,
  /** Images that could not be uploaded, so they stay reachable as links. */
  unattached: DiscordAttachment[] = context.attachments,
): string {
  const blocks: string[] = [];

  // Early, because it is the first thing whoever picks this up will click.
  if (issue.url) blocks.push(`**Halaman**\n${issue.url}`);
  if (issue.why) blocks.push(`**Kenapa penting**\n${issue.why}`);

  if (unattached.length > 0) {
    const links = unattached.map((a) => `- [${a.filename}](${a.url})`).join('\n');
    blocks.push(`**Gambar**\n${links}\n\n⚠️ Link Discord kedaluwarsa ~24 jam.`);
  }

  const origin = context.sourceLink
    ? `dari @${context.author} di [Discord](${context.sourceLink})`
    : `dari @${context.author} di Discord`;
  const source = context.filedBy ? `${origin} · dicatat oleh @${context.filedBy}` : origin;

  // Kept whether or not the model ran. Once the description is no longer
  // rendered as prose, this is the only record of what was actually reported,
  // and the subtask list on the task is a machine's reading of it.
  const written = context.rawInput.trim();
  const footer = written
    ? `---\n📥 ${source}\n\n**Tulisan asli:**\n${quote(written)}`
    : `---\n📥 ${source}`;

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n\n${footer}` : footer;
}

function quote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}
