// A gateway bot with slash commands, a button and a modal.
//   deno run --env-file --allow-env --allow-net examples/gateway_bot.ts
import {
    ActivityType,
    ButtonStyle,
    Client,
    ComponentType,
    GatewayIntentBits,
    LogLevel,
    PresenceUpdateStatus,
    TextInputStyle,
} from "../mod.ts";

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

client.on("INTERACTION_CREATE", async (i) => {
    if (i.isChatInputCommand()) {
        switch (i.commandName) {
            case "ping":
                await i.reply({
                    content: `Pong! Gateway latency: ${client.latency}ms`,
                    components: [{
                        type: ComponentType.ActionRow,
                        components: [{
                            type: ComponentType.Button,
                            style: ButtonStyle.Primary,
                            custom_id: "again",
                            label: "Again",
                        }],
                    }],
                });
                break;
            case "echo":
                await i.reply({ content: i.getOption<string>("text"), ephemeral: i.getOption<boolean>("private") });
                break;
            case "feedback":
                await i.showModal({
                    custom_id: "feedback_form",
                    title: "Feedback",
                    components: [{
                        type: ComponentType.Label,
                        label: "What do you think?",
                        component: {
                            type: ComponentType.TextInput,
                            custom_id: "text",
                            style: TextInputStyle.Paragraph,
                        },
                    }],
                });
                break;
        }
    } else if (i.isButton() && i.customId === "again") {
        await i.update({ content: `Pong again! Latency: ${client.latency}ms` });
    } else if (i.isModalSubmit() && i.customId === "feedback_form") {
        await i.reply({ content: `Thanks! You wrote: ${i.modalValues.text}`, ephemeral: true });
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
