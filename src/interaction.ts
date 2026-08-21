/** Shapes of the Discord interaction payload this Worker reads. */

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

export interface DiscordMessage {
  id: string;
  content: string;
  attachments: DiscordAttachment[];
  author?: { id?: string; username?: string; global_name?: string };
}

export interface Interaction {
  type?: number;
  /** Needed to build the follow-up webhook URL. */
  application_id?: string;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string; username?: string; global_name?: string } };
  user?: { id?: string; username?: string; global_name?: string };
  data?: {
    name?: string;
    /** 1 = slash command, 2 = user menu, 3 = message menu. */
    type?: number;
    custom_id?: string;
    components?: unknown;
    /** Message id the context menu was invoked on. */
    target_id?: string;
    /** Values chosen in a select menu. */
    values?: string[];
    resolved?: {
      attachments?: Record<string, DiscordAttachment>;
      messages?: Record<string, DiscordMessage>;
    };
  };
}

/**
 * Finds a submitted value by custom_id.
 *
 * Modal payloads nest components (Label wraps the real input) and Discord has
 * changed that nesting before, so this walks the tree instead of assuming a
 * fixed depth.
 */
export function findValue(components: unknown, customId: string): string | undefined {
  if (Array.isArray(components)) {
    for (const child of components) {
      const found = findValue(child, customId);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (components === null || typeof components !== 'object') return undefined;

  const node = components as Record<string, unknown>;
  if (node['custom_id'] === customId && typeof node['value'] === 'string') {
    return node['value'];
  }
  for (const key of ['component', 'components']) {
    const found = findValue(node[key], customId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Every file the user attached.
 *
 * Read from `resolved.attachments` rather than the component tree: the modal
 * has exactly one file field, and resolved is a flat map that survives any
 * future change to component nesting.
 */
export function attachmentsOf(interaction: Interaction): DiscordAttachment[] {
  return Object.values(interaction.data?.resolved?.attachments ?? {});
}

/**
 * Whether this guild may file issues.
 *
 * An empty list means unrestricted — the documented development default. A
 * guild-less interaction (a DM) has nothing to match, so it is refused once a
 * list is set.
 */
export function isGuildAllowed(
  allowList: readonly string[],
  guildId: string | undefined,
): boolean {
  return allowList.length === 0 || (guildId !== undefined && allowList.includes(guildId));
}

/** Discord user id of whoever triggered the interaction. */
export function userIdOf(interaction: Interaction): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

/** Display name of whoever triggered the interaction. */
export function authorOf(interaction: Interaction): string {
  const user = interaction.member?.user ?? interaction.user;
  return user?.global_name || user?.username || 'unknown';
}

/**
 * Discord handle of whoever triggered the interaction.
 *
 * Deliberately not falling back to `global_name` or `'unknown'` the way
 * `authorOf` does: this feeds a label, and a display name can be changed at any
 * time, which would silently split one person's history across two labels.
 * Null when Discord sent no handle, so the caller can omit the label entirely.
 */
export function usernameOf(interaction: Interaction): string | null {
  return usernameOfUser(interaction.member?.user ?? interaction.user);
}

/** Link back to the channel the issue came from. Modals have no message to cite. */
export function sourceLinkOf(interaction: Interaction): string | null {
  const { guild_id: guild, channel_id: channel } = interaction;
  return guild && channel ? `https://discord.com/channels/${guild}/${channel}` : null;
}

/** The message a context menu command was invoked on. */
export function targetMessageOf(interaction: Interaction): DiscordMessage | undefined {
  const id = interaction.data?.target_id;
  return id ? interaction.data?.resolved?.messages?.[id] : undefined;
}

/** Deep-link to a specific message, which is a better citation than the channel. */
export function messageLink(interaction: Interaction, messageId: string): string | null {
  const { guild_id: guild, channel_id: channel } = interaction;
  return guild && channel ? `https://discord.com/channels/${guild}/${channel}/${messageId}` : null;
}

export function displayName(user: DiscordMessage['author']): string {
  return user?.global_name || user?.username || 'unknown';
}

/** Same rule as `usernameOf`, for the author of a message rather than a clicker. */
export function usernameOfUser(user: DiscordMessage['author']): string | null {
  return user?.username || null;
}
