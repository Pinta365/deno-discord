// An HTTP interactions bot: no gateway connection, just a web server, using the same command router.
// Set the app's "Interactions Endpoint URL" in the Developer Portal to this server (e.g. via a tunnel).
// Commands must be registered once, e.g. by running examples/gateway_bot.ts.
//   deno run --env-file --allow-env --allow-net examples/http_bot.ts
import { createInteractionHandler, Logger, LogLevel, slash } from "../mod.ts";
import { router } from "./commands.ts";

router.add(
    slash({ name: "ping", description: "Replies from the HTTP bot" }, (i) => i.reply("Pong from HTTP!")),
    slash({ name: "status", description: "Slow command (auto-defer demo)" }, async (i) => {
        // The handler auto-defers after 2.5s; reply() then edits the deferred message.
        await new Promise((r) => setTimeout(r, 3000));
        await i.reply("Still alive, just slow.");
    }),
);

const handler = createInteractionHandler({
    publicKey: Deno.env.get("DISCORD_PUBLIC_KEY")!,
    // A token is only needed for REST calls that aren't interaction follow-ups.
    rest: { token: Deno.env.get("DISCORD_TOKEN") },
    logger: new Logger({ level: LogLevel.DEBUG }, "http"),
    onInteraction: (i) => router.handle(i),
});

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, handler);
