// Live smoke tests against the real Discord API. Not part of `deno task test` / CI.
//
//   deno task test:live
//
// Reads .env:
//   DISCORD_TOKEN            required, otherwise every test is skipped
//   DISCORD_GUILD_ID         optional, enables guild checks
//   DISCORD_TEST_CHANNEL_ID  optional, enables write checks (sends, edits, reacts to and deletes one message)
//
// Each gateway test starts a new session (1000 per day are allowed); running bots are not affected.
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import {
    API,
    Client,
    ComponentType,
    DiscordAPIError,
    GatewayIntentBits,
    LogLevel,
    PermissionFlagsBits,
    RestClient,
} from "../../mod.ts";
import {
    button,
    componentsV2,
    container,
    file,
    gallery,
    row,
    section,
    separator,
    text,
    thumbnail,
} from "../../src/components/components.ts";

const token = Deno.env.get("DISCORD_TOKEN");
const guildId = Deno.env.get("DISCORD_GUILD_ID");
const channelId = Deno.env.get("DISCORD_TEST_CHANNEL_ID");

const rest = new RestClient({ token });
const api = new API(rest);

Deno.test({
    name: "rest: current user, application and guilds",
    ignore: !token,
    async fn() {
        const me = await api.users.getCurrent();
        assert(me.bot, "token should belong to a bot user");
        const app = await api.applications.getCurrent();
        assertEquals(app.bot?.id, me.id);
        const guilds = await api.users.getCurrentGuilds();
        assert(Array.isArray(guilds));
    },
});

Deno.test({
    name: "rest: errors become DiscordAPIError with Discord's error code",
    ignore: !token,
    async fn() {
        const error = await assertRejects(() => api.channels.get("1"), DiscordAPIError);
        assert(error.status === 404 || error.status === 403, `unexpected status ${error.status}`);
        assertExists(error.code);
    },
});

Deno.test({
    name: "rest: guild, channels, member and commands",
    ignore: !token || !guildId,
    async fn() {
        const guild = await api.guilds.get(guildId!, { with_counts: true });
        assertEquals(guild.id, guildId);
        assertExists(guild.approximate_member_count);
        const channels = await api.guilds.getChannels(guildId!);
        assert(channels.length > 0);
        const me = await api.users.getCurrent();
        const member = await api.guilds.getMember(guildId!, me.id);
        assertEquals(member.user.id, me.id);
        const app = await api.applications.getCurrent();
        const commands = await api.applications.getGuildCommands(app.id, guildId!);
        assert(Array.isArray(commands));
    },
});

Deno.test({
    name: "rest: send, edit, react to and delete a message (with a file)",
    ignore: !token || !channelId,
    async fn() {
        const sent = await api.channels.createMessage(channelId!, {
            content: "@pinta365/discord live smoke test (will be deleted)",
            files: [{ name: "smoke.txt", data: `ran at ${new Date().toISOString()}` }],
        });
        try {
            assertEquals(sent.attachments.length, 1);
            assertEquals(sent.attachments[0].filename, "smoke.txt");
            const edited = await api.channels.editMessage(
                channelId!,
                sent.id,
                "@pinta365/discord live smoke test (edited)",
            );
            assertEquals(edited.content, "@pinta365/discord live smoke test (edited)");
            await api.channels.addReaction(channelId!, sent.id, "✅");
            const users = await api.channels.getReactions(channelId!, sent.id, "✅");
            assertEquals(users.length, 1);
        } finally {
            await api.channels.deleteMessage(channelId!, sent.id);
        }
    },
});

Deno.test({
    name: "rest: Discord accepts a Components v2 message built with the builders",
    ignore: !token || !channelId,
    async fn() {
        const avatar = "https://cdn.discordapp.com/embed/avatars/0.png";
        const sent = await api.channels.createMessage(channelId!, {
            ...componentsV2([
                container({ accent: 0x5865f2 }, [
                    "## @pinta365/discord live smoke test",
                    section(["Components v2 builders", "-# will be deleted"], thumbnail(avatar)),
                    separator({ spacing: "large" }),
                    gallery(avatar, { url: avatar, description: "second" }),
                    file("attachment://report.txt"),
                    row(button.primary("smoke_ok", "OK", { emoji: "✅" }), button.link("https://jsr.io", "JSR")),
                ]),
                text("outside the container"),
            ]),
            files: [{ name: "report.txt", data: "components v2 file component" }],
        });
        try {
            assertEquals(sent.components?.length, 2);
            // A file used by a file() component is shown in the component, not in message.attachments.
            const box = sent.components![0] as { components: { type: number; file?: { url: string } }[] };
            const fileComponent = box.components.find((c) => c.type === ComponentType.File);
            assertExists(fileComponent?.file?.url);
            assert(!fileComponent.file.url.startsWith("attachment://"), "Discord resolved the uploaded file");
        } finally {
            await api.channels.deleteMessage(channelId!, sent.id);
        }
    },
});

Deno.test({
    name: "cache: populated from GUILD_CREATE (guild, channels, roles, own member, permissions)",
    ignore: !token || !guildId,
    async fn() {
        const client = new Client({
            token: token!,
            intents: [GatewayIntentBits.Guilds],
            cache: true,
            logger: { level: LogLevel.WARN },
        });
        const guildCreate = new Promise<void>((resolve) => {
            client.on("GUILD_CREATE", (guild) => guild.id === guildId && resolve());
        });
        try {
            await withTimeout(client.connect(), 20_000, "connect()");
            await withTimeout(guildCreate, 20_000, "GUILD_CREATE");
            const cache = client.cache!;
            const guild = cache.guilds.get(guildId!);
            assertExists(guild);
            const restChannels = await api.guilds.getChannels(guildId!);
            for (const channel of restChannels) assertExists(cache.channels.get(channel.id), `channel ${channel.name}`);
            const restRoles = await api.guilds.getRoles(guildId!);
            assertEquals(cache.guildRoles(guildId!).length, restRoles.length);
            assertEquals(cache.me(guildId!)?.user.id, client.user?.id);
            assert(cache.can(PermissionFlagsBits.ViewChannel, guildId!), "bot should be able to view the guild");
            if (channelId) {
                assert(
                    cache.can(PermissionFlagsBits.SendMessages, guildId!, channelId),
                    "bot can send in test channel",
                );
            }
        } finally {
            client.close();
            await new Promise((r) => setTimeout(r, 500));
        }
    },
});

for (const compress of [true, false]) {
    Deno.test({
        name: `gateway: connects and receives READY + GUILD_CREATE (compress: ${compress})`,
        ignore: !token,
        async fn() {
            const client = new Client({
                token: token!,
                intents: [GatewayIntentBits.Guilds],
                compress,
                logger: { level: LogLevel.WARN },
            });
            const ready = client.waitFor("READY");
            const guildCreate = guildId
                ? new Promise<void>((resolve) => {
                    const off = client.on("GUILD_CREATE", (guild) => {
                        if (guild.id === guildId) {
                            off();
                            resolve();
                        }
                    });
                })
                : Promise.resolve();
            try {
                await withTimeout(client.connect(), 20_000, "connect()");
                const [data] = await ready;
                assertEquals(data.user.id, client.user?.id);
                assertExists(client.applicationId);
                assertEquals(client.shards.get(0)?.status, "ready");
                await withTimeout(guildCreate, 20_000, "GUILD_CREATE");
            } finally {
                client.close();
                // Let the WebSocket finish closing so Deno's resource sanitizer is happy.
                await new Promise((r) => setTimeout(r, 500));
            }
        },
    });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
