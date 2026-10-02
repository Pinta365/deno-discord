// An HTTP interactions bot: no gateway connection, just a web server.
// Set the app's "Interactions Endpoint URL" in the Developer Portal to this server (e.g. via a tunnel).
//   deno run --env-file --allow-env --allow-net examples/http_bot.ts
import { createInteractionHandler, Logger, LogLevel } from "../mod.ts";

const handler = createInteractionHandler({
    publicKey: Deno.env.get("DISCORD_PUBLIC_KEY")!,
    // A token is only needed for REST calls that aren't interaction follow-ups.
    rest: { token: Deno.env.get("DISCORD_TOKEN") },
    logger: new Logger({ level: LogLevel.DEBUG }, "http"),
    onInteraction: async (i) => {
        if (i.commandName === "ping") {
            await i.reply("Pong from HTTP!");
        } else if (i.commandName === "echo") {
            // Slow work is fine: the handler auto-defers after 2.5s and reply() then edits the deferred message.
            await new Promise((r) => setTimeout(r, 3000));
            await i.reply({ content: i.getOption<string>("text"), ephemeral: i.getOption<boolean>("private") });
        }
    },
});

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, handler);
