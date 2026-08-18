import type { Interaction } from './interaction.ts';

/**
 * Replaces the deferred "thinking..." message with the real answer.
 *
 * The interaction token authenticates this call, so no bot token is involved.
 * Valid for 15 minutes after the interaction.
 */
export async function editOriginalResponse(
  interaction: Interaction,
  body: Record<string, unknown>,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord follow-up failed ${res.status}: ${await res.text()}`);
  }
}

/** Discord rejects message content longer than 2000 characters. */
export function truncate(text: string, limit = 1900): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…(dipotong)`;
}
