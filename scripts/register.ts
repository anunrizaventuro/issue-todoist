/**
 * Registers every command in COMMANDS as a guild command.
 *
 * Guild commands update instantly; global commands can take up to an hour to
 * propagate, which makes iterating painful. Run with: npm run register
 *
 * Reads credentials from the environment, falling back to .dev.vars so the
 * secrets stay in one gitignored place.
 */
import { readFileSync } from 'node:fs';
import { COMMANDS } from '../src/commands.ts';

function loadDevVars(): Record<string, string> {
  try {
    const vars: Record<string, string> = {};
    for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match?.[1] && match[2] !== undefined) vars[match[1]] = match[2];
    }
    return vars;
  } catch {
    return {};
  }
}

const devVars = loadDevVars();
const value = (key: string): string => {
  const found = process.env[key] || devVars[key];
  if (!found) {
    console.error(`Missing ${key}. Set it in .dev.vars or the environment.`);
    process.exit(1);
  }
  return found;
};

const appId = value('DISCORD_APP_ID');
const guildId = value('DISCORD_GUILD_ID');
const botToken = value('DISCORD_BOT_TOKEN');

const body = Object.entries(COMMANDS).map(([name, config]) => ({
  name,
  description: config.description,
  type: 1, // CHAT_INPUT
  // Left permissive on purpose: server admins restrict access per role under
  // Server Settings -> Integrations, without a redeploy.
}));

const res = await fetch(
  `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`,
  {
    method: 'PUT', // PUT replaces the full set, so removed commands disappear.
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  },
);

if (!res.ok) {
  console.error(`Discord returned ${res.status}:\n${await res.text()}`);
  process.exit(1);
}

const registered = (await res.json()) as Array<{ name: string }>;
console.log(`Registered ${registered.length} command(s) in guild ${guildId}:`);
for (const command of registered) console.log(`  /${command.name}`);
