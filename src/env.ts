import type { DraftBinding } from './draft.ts';

export interface Env {
  /** Discord app public key, used to verify every incoming interaction. */
  DISCORD_PUBLIC_KEY: string;
  /** Root of an OpenAI-compatible API, e.g. `https://openrouter.ai/api/v1`. */
  LLM_BASE_URL: string;
  /** Model id as that provider names it, e.g. `anthropic/claude-opus-5`. */
  LLM_MODEL: string;
  LLM_API_KEY: string;
  TODOIST_API_TOKEN: string;
  /** Comma-separated guild IDs. Empty string disables the check (dev only). */
  ALLOWED_GUILD_IDS: string;
  /** One Durable Object per draft awaiting review. */
  DRAFTS: DraftBinding;
  /** Minutes before an untouched draft files itself. Capped at 14. */
  REVIEW_TIMEOUT_MINUTES?: string;
}
