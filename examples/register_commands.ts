// Registers the example commands. Guild commands update instantly; global ones can take a while.
//   deno run --env-file --allow-env --allow-net examples/register_commands.ts
import { API, RestClient } from "../mod.ts";
import { commands } from "./commands.ts";

const api = new API(new RestClient({ token: Deno.env.get("DISCORD_TOKEN")! }));
const guildId = Deno.env.get("DISCORD_GUILD_ID");

const app = await api.applications.getCurrent();
const result = guildId
    ? await api.applications.bulkOverwriteGuildCommands(app.id, guildId, commands)
    : await api.applications.bulkOverwriteGlobalCommands(app.id, commands);

console.log(`Registered ${result.length} ${guildId ? `guild (${guildId})` : "global"} commands for ${app.name}`);
