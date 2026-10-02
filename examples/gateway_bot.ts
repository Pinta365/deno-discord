// A gateway bot with slash commands, buttons, a modal and a Components v2 message.
//   deno run --env-file --allow-env --allow-net examples/gateway_bot.ts
import { ActivityType, Client, GatewayIntentBits, LogLevel, PresenceUpdateStatus } from "../mod.ts";
import {
    button,
    componentsV2,
    container,
    label,
    modal,
    radioGroup,
    row,
    section,
    separator,
    textInput,
    thumbnail,
} from "../src/components/components.ts";

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

client.on("READY", (data) => {
    console.log(`Logged in as ${data.user.username} in ${data.guilds.length} guild(s)`);
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

client.on("INTERACTION_CREATE", async (i) => {
    if (i.isChatInputCommand()) {
        switch (i.commandName) {
            case "ping":
                await i.reply({
                    content: `Pong! Gateway latency: ${client.latency}ms`,
                    components: [row(button.primary("again", "Again"))],
                });
                break;
            case "echo":
                await i.reply({ content: i.getOption<string>("text"), ephemeral: i.getOption<boolean>("private") });
                break;
            case "feedback":
                await i.showModal(modal("feedback_form", "Feedback", [
                    label("How was it?", radioGroup("rating", ["Great", "Okay", "Bad"], { required: true })),
                    label("What do you think?", textInput("text", { style: "paragraph" })),
                ]));
                break;
            case "status":
                await i.reply(statusCard());
                break;
        }
    } else if (i.isButton() && i.customId === "again") {
        await i.update({ content: `Pong again! Latency: ${client.latency}ms` });
    } else if (i.isButton() && i.customId === "status_refresh") {
        await i.update(statusCard());
    } else if (i.isModalSubmit() && i.customId === "feedback_form") {
        const { rating, text } = i.modalValues;
        await i.reply({ content: `Thanks! Rating: ${rating}. You wrote: ${text || "(nothing)"}`, ephemeral: true });
    }
});

client.on("error", (error, shardId) => {
    console.error(`Shard ${shardId} failed:`, error.message);
    Deno.exit(1);
});

Deno.addSignalListener("SIGINT", () => {
    client.close();
    Deno.exit(0);
});

await client.connect();
