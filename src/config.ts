interface Config {
  discord: {
    guildIds: readonly string[];
  };
  todoist: {
    defaultProjectId: string;
    channels: Readonly<Record<string, string>>;
  };
}

/**
 * Every destination the bot has, in one place.
 *
 * These are IDs, not secrets, so they live in code rather than in
 * `wrangler.toml` or `.dev.vars`: a change of server or project is a change of
 * behaviour, and belongs in a commit that can be reviewed and rolled back.
 * The trade is that changing one means `npm run deploy`, not an edit in the
 * Cloudflare dashboard.
 */
export const CONFIG = {
  discord: {
    /**
     * Servers allowed to file issues, and the servers `npm run register`
     * installs the commands into.
     *
     * An empty list disables the check entirely — every server that adds the
     * app could then write into the Todoist projects below, so keep it filled.
     * Copy an ID with Developer Mode on: right-click the server → Copy Server ID.
     */
    guildIds: [
      '1392070580534251621',
      '940451541037490256',
      '1449550633035239537',  // LOGIKA
    ],
  },

  todoist: {
    /**
     * Where a report goes when its channel is not in the map below.
     *
     * The tail of the project's URL in the Todoist web app:
     * `https://app.todoist.com/app/project/<name>-<id>`. The account behind
     * `TODOIST_API_TOKEN` must be able to write to it.
     */
    defaultProjectId: '6hHmCp3r5qgFW9Q4',

    /**
     * Discord channel → Todoist project. This is what makes the destination
     * follow the place the report was written, and with it whoever can see
     * that channel: Discord already decides who may run a command where, so
     * the map needs no permission logic of its own.
     *
     * Threads are covered by their parent channel, so a channel listed here
     * takes its threads and forum posts with it.
     *
     * Ships empty on purpose: every report then goes to `defaultProjectId`,
     * exactly as before routing existed. Once there is at least one pair, an
     * unlisted channel still takes the default but its task is labelled
     * `needs-routing`, so the catch-all can be swept. Adding a pair means a
     * redeploy. IDs come from right-clicking the channel → Copy Channel ID.
     */
    channels: {
      '1512274401931034655': '6h8gXQGqrXxhj96c',  // VENTURO #officia → Officia
      '1461027385901056112': '6gPRpc384mR7x8QX',  // LOGIKA #tuai → Tuai Saham
    },
  },
} satisfies Config;
