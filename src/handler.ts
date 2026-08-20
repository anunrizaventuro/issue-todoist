import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import {
  isCommandName,
  MESSAGE_COMMAND_NAME,
  MESSAGE_COMMAND_TARGET,
  type CommandName,
} from './commands.ts';
import {
  buildIssueModal,
  deferEphemeral,
  ephemeral,
  MODAL_PREFIX,
  PAGE_URL_ID,
  RAW_INPUT_ID,
  TITLE_ID,
} from './discord.ts';
import { editOriginalResponse } from './followup.ts';
import {
  attachmentsOf,
  authorOf,
  displayName,
  findValue,
  isGuildAllowed,
  messageLink,
  sourceLinkOf,
  targetMessageOf,
  type Interaction,
} from './interaction.ts';
import type { IssueContext } from './issue.ts';
import { fileIssue, normalizeSubmission } from './process.ts';
import { resultMessage } from './result.ts';
import type { Env } from './env.ts';

/** Schedules background work that must outlive the response (Workers: ctx.waitUntil). */
export type WaitUntil = (promise: Promise<unknown>) => void;

/** Shortest issue we accept. Discord's client enforces the same via min_length. */
const MIN_ISSUE_LENGTH = 10;

/**
 * Handles one Discord interaction request.
 *
 * Deliberately free of Workers-specific globals so it can run under plain Node
 * in tests. The runtime adapter lives in index.ts.
 *
 * Discord requires an initial response within 3 seconds, so anything slower
 * than a static reply ACKs first (DEFERRED) and finishes through `waitUntil`.
 * The interaction token stays valid for 15 minutes.
 */
export async function handleInteraction(
  request: Request,
  env: Env,
  waitUntil: WaitUntil,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // The raw body must be read before parsing: the signature covers the exact bytes.
  const rawBody = await request.text();
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  if (!signature || !timestamp) {
    return new Response('Missing signature headers', { status: 401 });
  }

  const valid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  if (!valid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody) as Interaction;
  } catch {
    return new Response('Malformed body', { status: 400 });
  }

  // Guarded here rather than per-command: the modal's custom_id is guessable,
  // so a check that only covers the slash command covers nothing. PING is
  // exempt because it carries no guild, and refusing it un-registers the
  // endpoint in Discord.
  if (
    interaction.type !== InteractionType.PING &&
    !isGuildAllowed(env.ALLOWED_GUILD_IDS, interaction.guild_id)
  ) {
    return json(ephemeral('Bot ini belum diaktifkan untuk server ini.'));
  }

  switch (interaction.type) {
    // Discord sends a PING when the Interactions Endpoint URL is saved, and
    // periodically afterwards. Failing this check un-registers the endpoint.
    case InteractionType.PING:
      return json({ type: InteractionResponseType.PONG });

    case InteractionType.APPLICATION_COMMAND: {
      if (interaction.data?.name === MESSAGE_COMMAND_NAME) {
        return handleMessageCommand(interaction, env, waitUntil);
      }
      const name = interaction.data?.name;
      if (!isCommandName(name)) {
        return json(ephemeral('Command tidak dikenal.'));
      }
      // Opening a modal needs no backend work, so it answers well inside the
      // 3-second budget without deferring.
      return json(buildIssueModal(name));
    }

    case InteractionType.MODAL_SUBMIT:
      return handleModalSubmit(interaction, env, waitUntil);

    default:
      return new Response('Unhandled interaction type', { status: 400 });
  }
}

function handleModalSubmit(interaction: Interaction, env: Env, waitUntil: WaitUntil): Response {
  const command = interaction.data?.custom_id?.slice(MODAL_PREFIX.length);
  if (!interaction.data?.custom_id?.startsWith(MODAL_PREFIX) || !isCommandName(command)) {
    return json(ephemeral('Form tidak dikenal.'));
  }

  const rawInput = findValue(interaction.data.components, RAW_INPUT_ID)?.trim() ?? '';
  if (rawInput.length < MIN_ISSUE_LENGTH) {
    // Rejected before any API call is made.
    return json(ephemeral('Issue-nya terlalu pendek. Tolong tulis sedikit lebih detail.'));
  }

  const pageUrl = findValue(interaction.data.components, PAGE_URL_ID)?.trim() || null;
  const typedTitle = findValue(interaction.data.components, TITLE_ID)?.trim() || null;

  // ACK now, work later: everything past this point is outside the 3-second budget.
  waitUntil(createAndReport(interaction, env, command, rawInput, { pageUrl, typedTitle }));
  return json(deferEphemeral());
}

/**
 * Right-click -> Apps -> Buat Issue.
 *
 * The message itself is the issue, so there is no modal: its text and its
 * attachments are already exactly what we need, and pasting a screenshot into
 * the channel is the paste path the modal's upload box does not offer.
 */
function handleMessageCommand(
  interaction: Interaction,
  env: Env,
  waitUntil: WaitUntil,
): Response {
  const message = targetMessageOf(interaction);
  if (!message) {
    return json(ephemeral('Pesannya tidak terbaca. Coba lagi.'));
  }

  const rawInput = message.content.trim();
  if (rawInput.length < MIN_ISSUE_LENGTH) {
    // An image with no words would produce a meaningless title.
    return json(
      ephemeral('Pesan ini tidak punya cukup teks. Tambahkan keterangan, atau pakai `/issue`.'),
    );
  }

  const writer = displayName(message.author);
  const clicker = authorOf(interaction);

  waitUntil(
    createAndReport(interaction, env, MESSAGE_COMMAND_TARGET, rawInput, {
      author: writer,
      filedBy: clicker === writer ? null : clicker,
      sourceLink: messageLink(interaction, message.id),
      attachments: message.attachments ?? [],
    }),
  );
  return json(deferEphemeral());
}

async function createAndReport(
  interaction: Interaction,
  env: Env,
  command: CommandName,
  rawInput: string,
  overrides?: Partial<Omit<IssueContext, 'normalized' | 'command' | 'rawInput'>>,
): Promise<void> {
  const context = {
    command,
    rawInput,
    author: authorOf(interaction),
    filedBy: null,
    sourceLink: sourceLinkOf(interaction),
    // Only the modal has these fields; the context menu leaves them to the model.
    typedTitle: null,
    pageUrl: null,
    attachments: attachmentsOf(interaction),
    ...overrides,
  };

  const { issue, context: full } = await normalizeSubmission(env, context);
  const result = await fileIssue(env, issue, full);
  await editOriginalResponse(interaction, resultMessage(result, full));
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
