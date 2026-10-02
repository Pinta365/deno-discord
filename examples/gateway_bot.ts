// A gateway bot using the command framework. Registers its commands on startup.
//   deno run --env-file --allow-env --allow-net examples/gateway_bot.ts
// Set DISCORD_GUILD_ID to register guild commands (instant); otherwise they're registered globally.
import { ActivityType, Client, GatewayIntentBits, LogLevel, PresenceUpdateStatus, slash } from "../mod.ts";
import { button, componentsV2, container, row, section, separator, thumbnail } from "../src/components/components.ts";
import { router } from "./commands.ts";

const client = new Client({
    token: Deno.env.get("DISCORD_TOKEN")!,
    intents: [GatewayIntentBits.Guilds],
    presence: {
        since: null,
        activities: [{ name: "slash commands", type: ActivityType.Listening }],
        status: PresenceUpdateStatus.Online,
        afk: false,
    },
    logger: { level: LogLevel.INFO },
});

function statusCard() {
    const avatar = client.user?.avatar
        ? `https://cdn.discordapp.com/avatars/${client.user.id}/${client.user.avatar}.png`
        : "https://cdn.discordapp.com/embed/avatars/0.png";
    return componentsV2([
        container({ accent: 0x57f287 }, [
            section([`## ${client.user?.username ?? "Bot"} status`, "All systems operational"], thumbnail(avatar)),
            separator(),
            `**Gateway latency:** ${client.latency}ms\n**Shards:** ${client.shards.size}`,
            row(
                button.secondary("status_refresh", "Refresh", { emoji: "🔄" }),
                button.link("https://jsr.io/@pinta365/discord", "Library"),
            ),
        ]),
    ]);
}

// Gateway-specific commands (they need the client), added to the shared router.
router
    .add(
        slash({ name: "ping", description: "Replies with the gateway latency" }, (i) =>
            i.reply({
                content: `Pong! Gateway latency: ${client.latency}ms`,
                components: [row(button.primary("ping_again", "Again"))],
            })),
        slash({ name: "status", description: "Shows a Components v2 status card" }, (i) => i.reply(statusCard())),
    )
    .component("ping_again", (i) => i.update({ content: `Pong again! Latency: ${client.latency}ms` }))
    .component("status_refresh", (i) => i.update(statusCard()));

client.on("READY", async (data) => {
    console.log(`Logged in as ${data.user.username} in ${data.guilds.length} guild(s)`);
    const guildId = Deno.env.get("DISCORD_GUILD_ID");
    await router.register(client.api, data.application.id, { guildId });
    console.log(`Registered ${router.commands.length} ${guildId ? "guild" : "global"} commands`);
});

client.on("INTERACTION_CREATE", (i) => router.handle(i));

client.on("error", (error, shardId) => {
    console.error(`Shard ${shardId} failed:`, error.message);
    Deno.exit(1);
});

Deno.addSignalListener("SIGINT", () => {
    client.close();
    Deno.exit(0);
});

await client.connect();
