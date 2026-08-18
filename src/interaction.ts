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
    custom_id?: string;
    components?: unknown;
    resolved?: { attachments?: Record<string, DiscordAttachment> };
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

/** Display name of whoever triggered the interaction. */
export function authorOf(interaction: Interaction): string {
  const user = interaction.member?.user ?? interaction.user;
  return user?.global_name || user?.username || 'unknown';
}

/** Link back to the channel the issue came from. Modals have no message to cite. */
export function sourceLinkOf(interaction: Interaction): string | null {
  const { guild_id: guild, channel_id: channel } = interaction;
  return guild && channel ? `https://discord.com/channels/${guild}/${channel}` : null;
}
