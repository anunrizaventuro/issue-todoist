import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { CONFIG } from './config.ts';
import {
  isCommandName,
  MESSAGE_COMMAND_NAME,
  MESSAGE_COMMAND_TARGET,
  type CommandName,
} from './commands.ts';
import {
  buildEditModal,
  buildIssueModal,
  deferEphemeral,
  ephemeral,
  MODAL_PREFIX,
  PAGE_URL_ID,
  parseSubtasks,
  SUBTASKS_ID,
  RAW_INPUT_ID,
  TITLE_ID,
  WHY_ID,
} from './discord.ts';
import {
  isReporter,
  openDraft,
  parseDraftCustomId,
  reviewTimeoutMinutes,
  type Draft,
  type DraftAction,
  type DraftStub,
} from './draft.ts';
import { editOriginalResponse } from './followup.ts';
import {
  attachmentsOf,
  authorOf,
  displayName,
  findValue,
  isGuildAllowed,
  messageLink,
  sourceLinkOf,
  usernameOf,
  usernameOfUser,
  targetMessageOf,
  userIdOf,
  type Interaction,
} from './interaction.ts';
import type { IssueContext } from './issue.ts';
import { fileIssue, normalizeSubmission } from './process.ts';
import { resultMessage } from './result.ts';
import { cancelledMessage, closedMessage, reviewMessage, savingMessage } from './review.ts';
import type { Env } from './env.ts';

/** Schedules background work that must outlive the response (Workers: ctx.waitUntil). */
export type WaitUntil = (promise: Promise<unknown>) => void;

/** Shortest issue we accept. Discord's client enforces the same via min_length. */
const MIN_ISSUE_LENGTH = 10;

/**
 * Shortest title we accept.
 *
 * The title is the only mandatory field now, so it is the only thing standing
 * between an empty form and a task nobody can act on.
 */
const MIN_TITLE_LENGTH = 5;

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
    !isGuildAllowed(CONFIG.discord.guildIds, interaction.guild_id)
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

    case InteractionType.MESSAGE_COMPONENT:
      return handleDraftComponent(interaction, env, waitUntil);

    default:
      return new Response('Unhandled interaction type', { status: 400 });
  }
}

async function handleModalSubmit(
  interaction: Interaction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<Response> {
  // The modals a draft card opens carry their own prefix and are answered
  // by updating that card, not by starting a new submission.
  const ref = parseDraftCustomId(interaction.data?.custom_id);
  if (ref?.modal) return handleDraftModal(interaction, env, ref);

  const command = interaction.data?.custom_id?.slice(MODAL_PREFIX.length);
  if (!interaction.data?.custom_id?.startsWith(MODAL_PREFIX) || !isCommandName(command)) {
    return json(ephemeral('Form tidak dikenal.'));
  }

  const typedTitle = findValue(interaction.data.components, TITLE_ID)?.trim() || null;
  if (!typedTitle || typedTitle.length < MIN_TITLE_LENGTH) {
    // Rejected before any API call is made.
    return json(ephemeral('Judulnya terlalu pendek. Tolong tulis sedikit lebih jelas.'));
  }

  // Everything below the title is optional: a one-line report is still a report.
  const rawInput = findValue(interaction.data.components, RAW_INPUT_ID)?.trim() ?? '';
  const pageUrl = findValue(interaction.data.components, PAGE_URL_ID)?.trim() || null;
  const why = findValue(interaction.data.components, WHY_ID)?.trim() || null;

  // ACK now, work later: everything past this point is outside the 3-second budget.
  waitUntil(
    createDraftAndReview(interaction, env, command, rawInput, { pageUrl, typedTitle, why }),
  );
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
    createDraftAndReview(interaction, env, MESSAGE_COMMAND_TARGET, rawInput, {
      author: writer,
      authorUsername: usernameOfUser(message.author),
      filedBy: clicker === writer ? null : clicker,
      // Same condition as filedBy, so the two never disagree about who acted.
      filedByUsername: clicker === writer ? null : usernameOf(interaction),
      sourceLink: messageLink(interaction, message.id),
      attachments: message.attachments ?? [],
    }),
  );
  return json(deferEphemeral());
}

/**
 * Normalizes, then parks the result for review instead of filing it.
 *
 * If the draft cannot be stored the submission is filed the old way: a feature
 * meant to raise quality must never become the reason a report disappears.
 */
async function createDraftAndReview(
  interaction: Interaction,
  env: Env,
  command: CommandName,
  rawInput: string,
  overrides?: Partial<Omit<IssueContext, 'normalized' | 'command' | 'rawInput'>>,
): Promise<void> {
  const submitted = {
    command,
    rawInput,
    author: authorOf(interaction),
    authorUsername: usernameOf(interaction),
    filedBy: null,
    filedByUsername: null,
    sourceLink: sourceLinkOf(interaction),
    channelId: interaction.channel_id ?? null,
    channelParentId: interaction.channel?.parent_id ?? null,
    // Only the modal has these fields; the context menu leaves them to the model.
    typedTitle: null,
    pageUrl: null,
    why: null,
    attachments: attachmentsOf(interaction),
    ...overrides,
  };

  const { issue, context } = await normalizeSubmission(env, submitted);
  const minutes = reviewTimeoutMinutes(env);

  const draft: Draft = {
    id: crypto.randomUUID(),
    status: 'pending',
    issue,
    context,
    reporterId: userIdOf(interaction) ?? '',
    applicationId: interaction.application_id ?? '',
    token: interaction.token ?? '',
    taskUrl: null,
  };

  try {
    await openDraft(env, draft.id).start(draft, minutes * 60_000);
  } catch (cause) {
    console.error('Draft store unavailable, filing directly', cause);
    const result = await fileIssue(env, issue, context);
    await editOriginalResponse(interaction, resultMessage(result, context));
    return;
  }

  await editOriginalResponse(interaction, reviewMessage(draft, minutes));
}

/**
 * Every button and dropdown on a draft card.
 *
 * The draft object is the authority on whether an action is still allowed, so
 * this layer only routes, checks ownership, and picks the response type Discord
 * expects for each one.
 */
async function handleDraftComponent(
  interaction: Interaction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<Response> {
  const ref = parseDraftCustomId(interaction.data?.custom_id);
  if (!ref || ref.modal) return json(ephemeral('Tombol tidak dikenal.'));

  const stub = openDraft(env, ref.id);
  const draft = await stub.read();
  if (!draft) return json(ephemeral('Draft ini tidak ditemukan — mungkin sudah lama sekali.'));
  if (!isReporter(draft, userIdOf(interaction))) return json(ephemeral('Ini bukan draft kamu.'));
  if (draft.status !== 'pending') return json(update(closedMessage(draft)));

  switch (ref.action) {
    case 'ok':
      // Todoist is far too slow for the 3-second budget, so the result arrives
      // later by editing this same message.
      waitUntil(approveDraft(interaction, stub));
      return json(update(savingMessage(draft)));

    case 'edit':
      return json(buildEditModal(draft));

    case 'pr': {
      const next = await stub.priority(Number(interaction.data?.values?.[0]));
      return json(update(next ? reviewMessage(next, reviewTimeoutMinutes(env)) : closedMessage(draft)));
    }

    case 'x': {
      const cancelled = await stub.cancel();
      return json(update(cancelled ? cancelledMessage(cancelled) : closedMessage(draft)));
    }
  }
}

async function approveDraft(interaction: Interaction, stub: DraftStub): Promise<void> {
  const result = await stub.approve();
  const draft = await stub.read();

  if (!draft) {
    // Nothing left to describe, but the reporter is still watching the
    // saving card, which has no buttons to get them out of it.
    await editOriginalResponse(interaction, {
      content: 'Draft ini tidak ditemukan lagi.',
      components: [],
      flags: InteractionResponseFlags.EPHEMERAL,
    });
    return;
  }
  if (result === 'closed') {
    await editOriginalResponse(interaction, closedMessage(draft));
    return;
  }

  await editOriginalResponse(interaction, resultMessage(result, draft.context));
}

/** The one modal a draft card can open. */
async function handleDraftModal(
  interaction: Interaction,
  env: Env,
  ref: { action: DraftAction; id: string },
): Promise<Response> {
  const stub = openDraft(env, ref.id);
  const draft = await stub.read();
  if (!draft) return json(ephemeral('Draft ini tidak ditemukan.'));
  if (!isReporter(draft, userIdOf(interaction))) return json(ephemeral('Ini bukan draft kamu.'));
  if (draft.status !== 'pending') return json(update(closedMessage(draft)));

  const components = interaction.data?.components;

  // Nothing here calls the provider, so it is fast enough to answer inline
  // rather than deferring.
  const next = await stub.edit({
    title: findValue(components, TITLE_ID)?.trim() || draft.issue.title,
    url: findValue(components, PAGE_URL_ID)?.trim() || null,
    why: findValue(components, WHY_ID)?.trim() || null,
    subtasks: parseSubtasks(findValue(components, SUBTASKS_ID)),
  });

  return json(update(next ? reviewMessage(next, reviewTimeoutMinutes(env)) : closedMessage(draft)));
}

/** Replaces the card the button was attached to. */
function update(body: Record<string, unknown>) {
  return { type: InteractionResponseType.UPDATE_MESSAGE, data: body };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
