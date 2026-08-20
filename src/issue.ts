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
  problem: string;
  expected: string | null;
  action: string | null;
  /** Todoist scale: 1 = normal ... 4 = urgent. Inverted from p1-p4 in the UI. */
  priority: 1 | 2 | 3 | 4;
  /** English or an ISO date — Todoist cannot parse Indonesian dates. */
  dueString: string | null;
  /** Page the issue is about: typed into the form, or found in the text. */
  url: string | null;
  /**
   * Why this matters, in the reporter's own words.
   *
   * Never written by the model — it is the one thing only the person who hit
   * the problem can answer, so rewriting it would be inventing motivation.
   */
  why: string | null;
  /** One Todoist child task each. Empty for the great majority of reports. */
  subtasks: string[];
  needsClarification: boolean;
  clarification: string | null;
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
    problem: rawInput,
    expected: null,
    action: null,
    priority: 1,
    dueString: null,
    url: null,
    why: null,
    subtasks: [],
    needsClarification: false,
    clarification: null,
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
 * Empty sections are omitted entirely — a template full of "Expected: -" is
 * noise, and this is meant to stay lighter than a Jira ticket.
 */
export function renderDescription(
  issue: NormalizedIssue,
  context: IssueContext,
  /** Images that never reached Todoist. Defaults to all of them. */
  unattached: DiscordAttachment[] = context.attachments,
): string {
  const blocks: string[] = [];

  if (context.normalized) {
    blocks.push(`**Masalah**\n${issue.problem}`);
    if (issue.expected) blocks.push(`**Harapan**\n${issue.expected}`);
    if (issue.action) blocks.push(`**Langkah**\n${issue.action}`);
  } else {
    // Nothing was restructured, so presenting it under headings would imply a
    // rigour that isn't there.
    blocks.push(issue.problem);
  }

  // Verbatim: this is the reporter's own reason, not something to restructure.
  if (issue.why) blocks.push(`**Kenapa penting**\n${issue.why}`);

  // Early, because it is the first thing whoever picks this up will click.
  if (issue.url) blocks.push(`**Halaman**\n${issue.url}`);

  if (issue.needsClarification && issue.clarification) {
    blocks.push(`**Perlu diperjelas**\n${issue.clarification}`);
  }

  // Anything Todoist holds is already shown on the task as a real attachment;
  // repeating it here would only add a URL that dies within a day.
  if (unattached.length > 0) {
    const links = unattached
      .map((a) => `- [${a.filename}](${a.url})`)
      .join('\n');
    blocks.push(`**Gambar**\n${links}\n\n⚠️ Link Discord kedaluwarsa ~24 jam.`);
  }

  const origin = context.sourceLink
    ? `dari @${context.author} di [Discord](${context.sourceLink})`
    : `dari @${context.author} di Discord`;
  const source = context.filedBy ? `${origin} · dicatat oleh @${context.filedBy}` : origin;
  const footer = context.normalized
    ? `---\n📥 ${source}\n\n**Tulisan asli:**\n${quote(context.rawInput)}`
    : `---\n📥 ${source}`;

  return `${blocks.join('\n\n')}\n\n${footer}`;
}

function quote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}
