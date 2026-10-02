import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import {
    type APIChannel,
    type APIMessage,
    type APIRole,
    ChannelType,
    GatewayDispatchEvents,
    type GatewayDispatchPayload,
    OverwriteType,
    PermissionFlagsBits,
} from "discord-api-types/v10";
import { API, Cache, RestClient } from "../mod.ts";

const BOT = "100";
const GUILD = "200";
const OWNER = "300";

function dispatch(t: string, d: unknown): GatewayDispatchPayload {
    return { op: 0, s: 1, t, d } as GatewayDispatchPayload;
}

function role(id: string, permissions: bigint = 0n): APIRole {
    return {
        id,
        name: `role-${id}`,
        color: 0,
        colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
        hoist: false,
        position: 0,
        permissions: String(permissions),
        managed: false,
        mentionable: false,
        flags: 0 as APIRole["flags"],
        icon: null,
        unicode_emoji: null,
    };
}

function textChannel(id: string, extra: Record<string, unknown> = {}): APIChannel {
    return { id, type: ChannelType.GuildText, name: `chan-${id}`, position: 0, ...extra } as unknown as APIChannel;
}

function thread(id: string, parentId: string): APIChannel {
    return { id, type: ChannelType.PublicThread, name: `thread-${id}`, parent_id: parentId } as unknown as APIChannel;
}

function message(id: string, channelId: string, content = "hi"): APIMessage {
    return { id, channel_id: channelId, content } as unknown as APIMessage;
}

function guildCreate(overrides: Record<string, unknown> = {}): GatewayDispatchPayload {
    return dispatch(GatewayDispatchEvents.GuildCreate, {
        id: GUILD,
        name: "Test guild",
        owner_id: OWNER,
        emojis: [],
        stickers: [],
        roles: [role(GUILD, PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages), role("401")],
        channels: [textChannel("500"), textChannel("501")],
        threads: [thread("600", "500")],
        members: [
            { user: { id: BOT, username: "bot" }, roles: ["401"], joined_at: "2024-01-01" },
            { user: { id: "999", username: "someone" }, roles: [], joined_at: "2024-01-01" },
        ],
        presences: [],
        voice_states: [],
        stage_instances: [],
        guild_scheduled_events: [],
        soundboard_sounds: [],
        joined_at: "2024-01-01",
        large: false,
        member_count: 2,
        ...overrides,
    });
}

/** A cache that has received READY and a GUILD_CREATE. */
function readyCache(options: ConstructorParameters<typeof Cache>[0] = {}, api: API | null = null): Cache {
    const cache = new Cache(options, api);
    cache.handle(
        dispatch(GatewayDispatchEvents.Ready, { user: { id: BOT }, guilds: [{ id: GUILD, unavailable: true }] }),
    );
    cache.handle(guildCreate());
    return cache;
}

Deno.test("READY sets the user ID, clears old state and marks guilds unavailable", () => {
    const cache = readyCache();
    cache.handle(
        dispatch(GatewayDispatchEvents.Ready, { user: { id: BOT }, guilds: [{ id: "201", unavailable: true }] }),
    );
    assertEquals(cache.userId, BOT);
    assertEquals(cache.guilds.size, 0);
    assertEquals(cache.channels.size, 0);
    assert(cache.unavailableGuilds.has("201"));
});

Deno.test("GUILD_CREATE splits the snapshot into guild, channels, threads, roles and own member", () => {
    const cache = readyCache();
    const guild = cache.guilds.get(GUILD)!;
    assertEquals(guild.name, "Test guild");
    for (const key of ["channels", "threads", "members", "roles", "presences", "voice_states"]) {
        assertFalse(key in guild, `guild should not keep ${key}`);
    }
    assertFalse(cache.unavailableGuilds.has(GUILD));
    assertEquals(cache.guildChannels(GUILD).map((c) => c.id).sort(), ["500", "501", "600"]);
    assertEquals((cache.channels.get("500") as { guild_id?: string }).guild_id, GUILD);
    assertEquals(cache.guildRoles(GUILD).length, 2);
    assertEquals(cache.roles.get("401")?.guild_id, GUILD);
    assertEquals(cache.me(GUILD)?.user.id, BOT);
    assertEquals(cache.members.size, 1, "only the bot's own member is cached");
});

Deno.test("a second GUILD_CREATE replaces the guild instead of merging", () => {
    const cache = readyCache();
    cache.handle(guildCreate({ channels: [textChannel("502")], threads: [], roles: [role(GUILD)] }));
    assertEquals(cache.guildChannels(GUILD).map((c) => c.id), ["502"]);
    assertFalse(cache.channels.has("500"));
    assertFalse(cache.roles.has("401"));
});

Deno.test("GUILD_CREATE with unavailable only marks the guild unavailable", () => {
    const cache = new Cache();
    cache.handle(dispatch(GatewayDispatchEvents.GuildCreate, { id: "201", unavailable: true }));
    assert(cache.unavailableGuilds.has("201"));
    assertFalse(cache.guilds.has("201"));
});

Deno.test("GUILD_UPDATE merges guild fields and updates roles", () => {
    const cache = readyCache();
    const updated = role("401", PermissionFlagsBits.ManageMessages);
    cache.handle(dispatch(GatewayDispatchEvents.GuildUpdate, { id: GUILD, name: "Renamed", roles: [updated] }));
    assertEquals(cache.guilds.get(GUILD)?.name, "Renamed");
    assertEquals(cache.guilds.get(GUILD)?.owner_id, OWNER);
    assertEquals(cache.roles.get("401")?.permissions, String(PermissionFlagsBits.ManageMessages));
});

Deno.test("GUILD_DELETE during an outage keeps the data", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.GuildDelete, { id: GUILD, unavailable: true }));
    assert(cache.guilds.has(GUILD));
    assert(cache.unavailableGuilds.has(GUILD));
});

Deno.test("GUILD_DELETE when removed drops the guild and everything in it", () => {
    const cache = readyCache({ messagesPerChannel: 5 });
    cache.handle(dispatch(GatewayDispatchEvents.MessageCreate, message("700", "500")));
    cache.handle(dispatch(GatewayDispatchEvents.GuildDelete, { id: GUILD }));
    assertEquals(cache.guilds.size, 0);
    assertEquals(cache.channels.size, 0);
    assertEquals(cache.roles.size, 0);
    assertEquals(cache.members.size, 0);
    assertEquals(cache.messages("500"), []);
});

Deno.test("GUILD_EMOJIS_UPDATE and GUILD_STICKERS_UPDATE replace the lists", () => {
    const cache = readyCache();
    cache.handle(
        dispatch(GatewayDispatchEvents.GuildEmojisUpdate, { guild_id: GUILD, emojis: [{ id: "1", name: "a" }] }),
    );
    cache.handle(dispatch(GatewayDispatchEvents.GuildStickersUpdate, { guild_id: GUILD, stickers: [{ id: "2" }] }));
    assertEquals(cache.guilds.get(GUILD)?.emojis.length, 1);
    assertEquals(cache.guilds.get(GUILD)?.stickers?.length, 1);
});

Deno.test("role create, update and delete", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.GuildRoleCreate, { guild_id: GUILD, role: role("402") }));
    assertEquals(cache.guildRoles(GUILD).length, 3);
    cache.handle(
        dispatch(GatewayDispatchEvents.GuildRoleUpdate, { guild_id: GUILD, role: { ...role("402"), name: "x" } }),
    );
    assertEquals(cache.roles.get("402")?.name, "x");
    cache.handle(dispatch(GatewayDispatchEvents.GuildRoleDelete, { guild_id: GUILD, role_id: "402" }));
    assertFalse(cache.roles.has("402"));
    assertEquals(cache.guildRoles(GUILD).length, 2);
});

Deno.test("GUILD_MEMBER_UPDATE merges the bot's member and ignores other users", () => {
    const cache = readyCache();
    cache.handle(
        dispatch(GatewayDispatchEvents.GuildMemberUpdate, {
            guild_id: GUILD,
            user: { id: BOT },
            roles: ["401", "402"],
            nick: "Botty",
        }),
    );
    assertEquals(cache.me(GUILD)?.roles, ["401", "402"]);
    assertEquals(cache.me(GUILD)?.nick, "Botty");
    assertEquals(cache.me(GUILD)?.joined_at, "2024-01-01", "fields not in the update are kept");
    cache.handle(
        dispatch(GatewayDispatchEvents.GuildMemberUpdate, { guild_id: GUILD, user: { id: "999" }, roles: [] }),
    );
    assertEquals(cache.members.size, 1);
});

Deno.test("channel create, update and delete", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.ChannelCreate, textChannel("503", { guild_id: GUILD })));
    assert(cache.guildChannels(GUILD).some((c) => c.id === "503"));
    cache.handle(dispatch(GatewayDispatchEvents.ChannelUpdate, textChannel("503", { guild_id: GUILD, name: "new" })));
    assertEquals((cache.channels.get("503") as { name: string }).name, "new");
    cache.handle(dispatch(GatewayDispatchEvents.ChannelDelete, textChannel("503", { guild_id: GUILD })));
    assertFalse(cache.channels.has("503"));
    assertFalse(cache.guildChannels(GUILD).some((c) => c.id === "503"));
});

Deno.test("thread update merges and thread delete removes", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.ThreadUpdate, { id: "600", guild_id: GUILD, name: "renamed" }));
    const updated = cache.channels.get("600") as { name: string; parent_id: string };
    assertEquals(updated.name, "renamed");
    assertEquals(updated.parent_id, "500", "fields not in the update are kept");
    cache.handle(dispatch(GatewayDispatchEvents.ThreadDelete, { id: "600", guild_id: GUILD, parent_id: "500" }));
    assertFalse(cache.channels.has("600"));
});

Deno.test("THREAD_LIST_SYNC with channel_ids only replaces threads of those parents", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.ThreadCreate, { ...thread("601", "501"), guild_id: GUILD }));
    cache.handle(
        dispatch(GatewayDispatchEvents.ThreadListSync, {
            guild_id: GUILD,
            channel_ids: ["500"],
            threads: [thread("602", "500")],
            members: [],
        }),
    );
    assertFalse(cache.channels.has("600"), "old thread under synced parent removed");
    assert(cache.channels.has("601"), "thread under other parent kept");
    assert(cache.channels.has("602"));
    assert(cache.channels.has("500") && cache.channels.has("501"), "regular channels untouched");
});

Deno.test("THREAD_LIST_SYNC without channel_ids replaces every thread in the guild", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.ThreadCreate, { ...thread("601", "501"), guild_id: GUILD }));
    cache.handle(
        dispatch(GatewayDispatchEvents.ThreadListSync, {
            guild_id: GUILD,
            threads: [thread("603", "501")],
            members: [],
        }),
    );
    assertFalse(cache.channels.has("600"));
    assertFalse(cache.channels.has("601"));
    assertEquals((cache.channels.get("603") as { guild_id?: string }).guild_id, GUILD);
    assert(cache.channels.has("500"));
});

Deno.test("messages are not cached by default", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.MessageCreate, message("700", "500")));
    assertEquals(cache.messages("500"), []);
});

Deno.test("message cache keeps the newest N, merges updates, and handles deletes", () => {
    const cache = readyCache({ messagesPerChannel: 2 });
    for (const id of ["700", "701", "702"]) {
        cache.handle(dispatch(GatewayDispatchEvents.MessageCreate, message(id, "500")));
    }
    assertEquals(cache.messages("500").map((m) => m.id), ["701", "702"]);

    cache.handle(dispatch(GatewayDispatchEvents.MessageUpdate, { id: "702", channel_id: "500", content: "edited" }));
    assertEquals(cache.message("500", "702")?.content, "edited");
    cache.handle(dispatch(GatewayDispatchEvents.MessageUpdate, { id: "700", channel_id: "500", content: "x" }));
    assertEquals(cache.message("500", "700"), undefined, "updates for uncached messages are ignored");

    cache.handle(dispatch(GatewayDispatchEvents.MessageDelete, { id: "701", channel_id: "500" }));
    assertEquals(cache.messages("500").map((m) => m.id), ["702"]);
    cache.handle(dispatch(GatewayDispatchEvents.MessageCreate, message("703", "500")));
    cache.handle(dispatch(GatewayDispatchEvents.MessageDeleteBulk, { ids: ["702", "703"], channel_id: "500" }));
    assertEquals(cache.messages("500"), []);

    cache.handle(dispatch(GatewayDispatchEvents.MessageCreate, message("704", "501")));
    cache.handle(dispatch(GatewayDispatchEvents.ChannelDelete, textChannel("501", { guild_id: GUILD })));
    assertEquals(cache.messages("501"), [], "deleting a channel drops its messages");
});

Deno.test("permissions: guild level combines @everyone and member roles", () => {
    const cache = readyCache();
    cache.handle(
        dispatch(GatewayDispatchEvents.GuildRoleUpdate, {
            guild_id: GUILD,
            role: role("401", PermissionFlagsBits.ManageMessages),
        }),
    );
    const perms = cache.permissions(GUILD)!;
    assert(perms & PermissionFlagsBits.ViewChannel);
    assert(perms & PermissionFlagsBits.ManageMessages);
    assertFalse(perms & PermissionFlagsBits.BanMembers);
});

Deno.test("permissions: channel overwrites apply and threads use the parent's", () => {
    const cache = readyCache();
    cache.handle(
        dispatch(
            GatewayDispatchEvents.ChannelUpdate,
            textChannel("500", {
                guild_id: GUILD,
                permission_overwrites: [
                    { id: GUILD, type: OverwriteType.Role, allow: "0", deny: String(PermissionFlagsBits.SendMessages) },
                ],
            }),
        ),
    );
    assertFalse(cache.can(PermissionFlagsBits.SendMessages, GUILD, "500"));
    assert(cache.can(PermissionFlagsBits.ViewChannel, GUILD, "500"));
    assertFalse(cache.can(PermissionFlagsBits.SendMessages, GUILD, "600"), "thread inherits parent overwrites");
    assert(cache.can(PermissionFlagsBits.SendMessages, GUILD, "501"));
});

Deno.test("permissions: owner and Administrator get everything", () => {
    const cache = readyCache();
    cache.handle(dispatch(GatewayDispatchEvents.GuildUpdate, { id: GUILD, owner_id: BOT }));
    assert(cache.can(PermissionFlagsBits.BanMembers, GUILD));

    const admin = readyCache();
    admin.handle(
        dispatch(GatewayDispatchEvents.GuildRoleUpdate, {
            guild_id: GUILD,
            role: role("401", PermissionFlagsBits.Administrator),
        }),
    );
    assert(admin.can(PermissionFlagsBits.BanMembers | PermissionFlagsBits.ManageGuild, GUILD, "500"));
});

Deno.test("permissions: undefined when the data isn't cached", () => {
    const cache = new Cache();
    assertEquals(cache.permissions(GUILD), undefined);
    assertFalse(cache.can(PermissionFlagsBits.ViewChannel, GUILD));
    const ready = readyCache();
    assertEquals(ready.permissions(GUILD, "does-not-exist"), undefined);
});

Deno.test("fetchGuild/fetchChannel use the cache, then REST on a miss", async () => {
    const requests: string[] = [];
    const fetch = (input: string | URL | Request) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        requests.push(path);
        const body = path.endsWith("/channels/800")
            ? textChannel("800", { guild_id: GUILD })
            : { id: "201", name: "Fetched", owner_id: OWNER, roles: [role("201")], emojis: [] };
        return Promise.resolve(Response.json(body));
    };
    const api = new API(new RestClient({ token: "t", fetch: fetch as typeof globalThis.fetch }));
    const cache = readyCache({}, api);

    assertEquals((await cache.fetchGuild(GUILD)).name, "Test guild");
    assertEquals((await cache.fetchChannel("500")).id, "500");
    assertEquals(requests, []);

    assertEquals((await cache.fetchGuild("201")).name, "Fetched");
    assert(cache.roles.has("201"));
    assertEquals((await cache.fetchChannel("800")).id, "800");
    assert(cache.guildChannels(GUILD).some((c) => c.id === "800"));
    assertEquals(requests.length, 2);

    await cache.fetchGuild("201");
    assertEquals(requests.length, 2, "second lookup is served from cache");
});

Deno.test("fetch helpers throw without an API", async () => {
    await assertRejects(() => new Cache().fetchChannel("1"), Error, "no API");
});
