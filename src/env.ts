export interface Env {
  /** Discord app public key, used to verify every incoming interaction. */
  DISCORD_PUBLIC_KEY: string;
  ANTHROPIC_API_KEY: string;
  TODOIST_API_TOKEN: string;
  /** Comma-separated guild IDs. Empty string disables the check (dev only). */
  ALLOWED_GUILD_IDS: string;
}
