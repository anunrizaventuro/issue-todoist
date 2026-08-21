interface Config {
  discord: {
    guildIds: readonly string[];
    channelId: string;
  };
  todoist: {
    projectId: string;
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
     * app could then write into the Todoist project below, so keep it filled.
     * Copy an ID with Developer Mode on: right-click the server → Copy Server ID.
     */
    guildIds: ['1392070580534251621'],

    /**
     * Where the team is expected to use the bot. Nothing reads this — it is a
     * note for whoever comes back to this file in six months. The bot answers
     * in any channel of the servers above; to genuinely restrict it, use
     * Server Settings → Integrations → the app, which needs no redeploy.
     */
    channelId: '',
  },

  todoist: {
    /**
     * The project every issue is filed into.
     *
     * The tail of the project's URL in the Todoist web app:
     * `https://app.todoist.com/app/project/<name>-<id>`. The account behind
     * `TODOIST_API_TOKEN` must be able to write to it.
     */
    projectId: '6hHmCp3r5qgFW9Q4',
  },
} satisfies Config;
