import type { Interaction } from './interaction.ts';

/**
 * Replaces the deferred "thinking..." message with the real answer.
 *
 * Takes credentials rather than an Interaction because the alarm that files an
 * abandoned draft has no request of its own — it reads them back from storage.
 *
 * The interaction token authenticates this call, so no bot token is involved.
 * Valid for 15 minutes after the interaction.
 */
export async function editOriginal(
  applicationId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord follow-up failed ${res.status}: ${await res.text()}`);
  }
}

/** Convenience for the request-handling path, which still has the interaction. */
export function editOriginalResponse(
  interaction: Interaction,
  body: Record<string, unknown>,
): Promise<void> {
  return editOriginal(interaction.application_id ?? '', interaction.token ?? '', body);
}

/** Discord rejects message content longer than 2000 characters. */
export function truncate(text: string, limit = 1900): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…(dipotong)`;
}
