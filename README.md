# @pinta365/discord

A small, modern Discord library for Deno. It covers:

- **Gateway bots:** sharding, resume, heartbeat acknowledgement tracking, zlib-stream compression, typed events.
- **HTTP interactions:** a `Request -> Response` handler for `Deno.serve` or Deno Deploy, with signature checks and
  auto-defer.
- **REST:** per-route rate limits, handling for global 429s, retries, timeouts, file uploads, audit-log reasons.
- **Types:** everything comes from [discord-api-types](https://github.com/discordjs/discord-api-types), so the library
  keeps up with Discord.

> Status: 0.x. APIs may still change between minor versions.
>
> This is a community library and isn't affiliated with or endorsed by Discord.

## Install

```sh
deno add jsr:@pinta365/discord
```

## Gateway bot

```ts
import { Client, GatewayIntentBits } from "@pinta365/discord";

const client = new Client({
    token: Deno.env.get("DISCORD_TOKEN")!,
    intents: [GatewayIntentBits.Guilds],
});

client.on("READY", (data) => console.log(`Logged in as ${data.user.username}`));

client.on("INTERACTION_CREATE", async (interaction) => {
    if (interaction.commandName === "ping") {
        await interaction.reply({ content: `Pong! ${client.latency}ms`, ephemeral: true });
    }
});

await client.connect();
```

Every gateway dispatch is emitted under its Discord name (`"MESSAGE_CREATE"`, `"GUILD_CREATE"`, …, or
`GatewayDispatchEvents.X`) with a typed payload. `INTERACTION_CREATE` gets an `Interaction` wrapper. `on()` returns an
unsubscribe function, and `once()` and `waitFor()` are available too.

## HTTP interactions (no gateway)

```ts
import { createInteractionHandler } from "@pinta365/discord";

Deno.serve(createInteractionHandler({
    publicKey: Deno.env.get("DISCORD_PUBLIC_KEY")!,
    onInteraction: async (interaction) => {
        if (interaction.commandName === "ping") await interaction.reply("Pong!");
    },
}));
```

Set the app's **Interactions Endpoint URL** in the Developer Portal to your server. If a handler hasn't responded after
2.5s, the interaction is deferred automatically and a later `reply()` edits the deferred message.

## Responding to interactions

`Interaction` works the same for gateway and HTTP bots:

| Method                                           | Use                                         |
| ------------------------------------------------ | ------------------------------------------- |
| `reply(content \| payload)`                      | Initial response (`ephemeral: true` option) |
| `deferReply({ ephemeral })` → `editReply(...)`   | Work that takes longer than 3 seconds       |
| `update(...)` / `deferUpdate()`                  | Edit the message a component is on          |
| `showModal(modal)`                               | Open a modal                                |
| `respondAutocomplete(choices)`                   | Autocomplete suggestions                    |
| `followUp(...)`, `fetchReply()`, `deleteReply()` | After the initial response                  |

Helpers for reading the interaction: `commandName`, `subcommand`, `subcommandGroup`, `getOption(name)`, `focusedOption`,
`customId`, `modalValues`, `user`, `guildId`, `channelId`, and type checks such as `isChatInputCommand()`, `isButton()`
and `isModalSubmit()`. Payloads accept files: `reply({ content, files: [{ name, data }] })`.

## Components and modals

Builder functions return plain discord-api-types objects, so they mix freely with hand-written JSON. Import them from
`@pinta365/discord/components`, or use the `components` namespace from the main entry point.

```ts
import { button, componentsV2, container, row, section, separator, thumbnail } from "@pinta365/discord/components";

// Components v2: layout, rich text, media. (content/embeds can't be combined with v2 messages.)
await interaction.reply(componentsV2([
    container({ accent: 0x57f287 }, [
        section(["## Status", "All systems operational"], thumbnail(avatarUrl)),
        separator(),
        row(button.secondary("refresh", "Refresh", { emoji: "🔄" }), button.link("https://example.com", "Docs")),
    ]),
]));

// Classic components work in normal messages too.
await interaction.reply({
    content: "Pick one",
    components: [row(button.primary("yes", "Yes"), button.danger("no", "No"))],
});
```

Also available: `text`, `gallery`, `file` (`attachment://…`), `stringSelect`, `userSelect`, `roleSelect`,
`mentionableSelect` and `channelSelect`.

Modals use labels wrapping inputs. Submitted values come back typed by input in `interaction.modalValues`:

```ts
await interaction.showModal(modal("feedback", "Feedback", [
    label("Rating", radioGroup("rating", ["Great", "Okay", "Bad"], { required: true })),
    label("Comments", textInput("text", { style: "paragraph" })),
]));

// on submit:
const { rating, text } = interaction.modalValues; // string | null, string
```

Modal inputs: `textInput`, `radioGroup`, `checkboxGroup`, `checkbox`, `fileUpload`, and select menus.

## Cache (optional)

Off by default. When enabled, guilds, channels (including threads), roles and the bot's own member in each guild are
kept up to date from gateway events. Messages can be cached too, with a limit per channel:

```ts
const client = new Client({ token, intents, cache: true }); // or: cache: { messagesPerChannel: 50 }

client.cache!.guilds.get(guildId)?.name;
client.cache!.guildChannels(guildId);
client.cache!.can(PermissionFlagsBits.SendMessages, guildId, channelId); // bot permissions incl. overwrites
await client.cache!.fetchChannel(channelId); // cached, or fetched via REST and cached
```

The cache is updated before your listeners run. Other members aren't cached; use `client.api.guilds.getMember()`.

## Convenience API

`client.api` (or `new API(rest)` for HTTP-only bots) wraps common endpoints with full typing:

```ts
await client.api.channels.createMessage(channelId, "Hello!");
await client.api.channels.addReaction(channelId, messageId, "👍");
await client.api.guilds.addMemberRole(guildId, userId, roleId, { reason: "Verified" });
await client.api.users.sendDM(userId, { content: "Welcome!", files: [{ name: "rules.txt", data: rules }] });
await client.api.applications.bulkOverwriteGuildCommands(appId, guildId, commands);
await client.api.webhooks.execute(webhookId, webhookToken, "Deployed ✅");
```

Groups: `channels` (messages, reactions, pins, threads, invites), `guilds` (members, roles, bans, emojis, audit log),
`users` (current user, DMs), `applications` (commands, entitlements, SKUs) and `webhooks`. For anything else, use
`RestClient` directly.

## REST

```ts
import { RestClient, Routes } from "@pinta365/discord";
import type { APIMessage } from "@pinta365/discord/types";

const rest = new RestClient({ token: Deno.env.get("DISCORD_TOKEN")! });

const message = await rest.post<APIMessage>(Routes.channelMessages(channelId), {
    body: { content: "Hello!" },
    files: [{ name: "hello.txt", data: "hi" }],
    reason: "Audit log reason",
});
```

Non-2xx responses throw `DiscordAPIError`, which has `status`, `code` and `errors`.

## Registering commands

See [`examples/register_commands.ts`](examples/register_commands.ts). It uses
`api.applications.bulkOverwriteGuildCommands` for instant guild commands, or `bulkOverwriteGlobalCommands` for global
ones.

## Logging

```ts
import { LogLevel } from "@pinta365/discord";
new Client({ token, intents, logger: { level: LogLevel.DEBUG, handler: (level, scope, args) => {/* ... */} } });
```

## Examples

```sh
deno run --env-file --allow-env --allow-net examples/register_commands.ts
deno run --env-file --allow-env --allow-net examples/gateway_bot.ts
deno run --env-file --allow-env --allow-net examples/http_bot.ts
```

## Development

```sh
deno task ci           # fmt, lint, type check, tests (no network)
deno task test:live    # live smoke tests against Discord, using .env (see tests/live/smoke.ts)
deno publish --dry-run
```

## License

MIT
