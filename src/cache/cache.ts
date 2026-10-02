import {
    type APIChannel,
    type APIGuild,
    type APIGuildMember,
    type APIMessage,
    type APIRole,
    ChannelType,
    GatewayDispatchEvents,
    type GatewayDispatchPayload,
    type GatewayGuildCreateDispatchData,
    type Snowflake,
} from "discord-api-types/v10";
import type { API } from "../api/api.ts";
import { applyOverwrites, computeBasePermissions } from "./permissions.ts";

/** A cached guild: the GUILD_CREATE payload minus the parts that live in other stores or aren't cached. */
export type CachedGuild =
    & Omit<
        GatewayGuildCreateDispatchData,
        | "channels"
        | "threads"
        | "members"
        | "presences"
        | "voice_states"
        | "roles"
        | "stage_instances"
        | "guild_scheduled_events"
        | "soundboard_sounds"
    >
    & Partial<Pick<GatewayGuildCreateDispatchData, "joined_at" | "large" | "member_count">>;

/** A cached role, with the guild it belongs to. */
export type CachedRole = APIRole & { guild_id: Snowflake };

/** Options for {@link Cache}. Guilds, channels, roles and the bot's own members are always cached. */
export interface CacheOptions {
    /**
     * Messages kept per channel (newest win). 0 disables the message cache. Defaults to 0.
     * Requires the `GuildMessages`/`DirectMessages` intents; content also needs `MessageContent`.
     */
    messagesPerChannel?: number;
}

/**
 * In-memory cache of guilds, channels (including threads), roles and the bot's own guild members,
 * plus an optional bounded message cache. Kept up to date from gateway events.
 *
 * Member caching (other than the bot itself) is intentionally not included.
 */
export class Cache {
    /** Guilds by ID. */
    readonly guilds: Map<Snowflake, CachedGuild> = new Map();
    /** Guild IDs that are currently unavailable (outage), but whose data is kept. */
    readonly unavailableGuilds: Set<Snowflake> = new Set();
    /** Channels and threads by ID. Guild channels always have `guild_id` set. */
    readonly channels: Map<Snowflake, APIChannel> = new Map();
    /** Roles by ID. */
    readonly roles: Map<Snowflake, CachedRole> = new Map();
    /** The bot's own member object, by guild ID. */
    readonly members: Map<Snowflake, APIGuildMember> = new Map();

    readonly #messagesPerChannel: number;
    readonly #messages = new Map<Snowflake, Map<Snowflake, APIMessage>>();
    readonly #guildChannels = new Map<Snowflake, Set<Snowflake>>();
    readonly #guildRoles = new Map<Snowflake, Set<Snowflake>>();
    #userId: Snowflake | null = null;
    #api: API | null;

    /**
     * Creates a cache. The client creates one automatically when `cache` is enabled.
     * @param options Cache options.
     * @param api API used by the `fetch*` helpers on a cache miss.
     */
    constructor(options: CacheOptions = {}, api: API | null = null) {
        this.#messagesPerChannel = options.messagesPerChannel ?? 0;
        this.#api = api;
    }

    /** The bot's user ID, known after READY. */
    get userId(): Snowflake | null {
        return this.#userId;
    }

    // --- reads -----------------------------------------------------------------------------------

    /** All channels and threads in a guild. */
    guildChannels(guildId: Snowflake): APIChannel[] {
        return [...this.#guildChannels.get(guildId) ?? []].map((id) => this.channels.get(id)!).filter(Boolean);
    }

    /** All roles in a guild. */
    guildRoles(guildId: Snowflake): CachedRole[] {
        return [...this.#guildRoles.get(guildId) ?? []].map((id) => this.roles.get(id)!).filter(Boolean);
    }

    /** The bot's own member object in a guild. */
    me(guildId: Snowflake): APIGuildMember | undefined {
        return this.members.get(guildId);
    }

    /** Cached messages in a channel, oldest first. Empty when the message cache is disabled. */
    messages(channelId: Snowflake): APIMessage[] {
        return [...this.#messages.get(channelId)?.values() ?? []];
    }

    /** A cached message. */
    message(channelId: Snowflake, messageId: Snowflake): APIMessage | undefined {
        return this.#messages.get(channelId)?.get(messageId);
    }

    /**
     * The bot's effective permissions in a guild channel or thread (threads use their parent's overwrites),
     * or in the guild itself when `channelId` is omitted. Returns `undefined` if the data isn't cached.
     */
    permissions(guildId: Snowflake, channelId?: Snowflake): bigint | undefined {
        const guild = this.guilds.get(guildId);
        const me = this.members.get(guildId);
        if (!guild || !me || !this.#userId) return undefined;

        const roles = new Map(this.guildRoles(guildId).map((r) => [r.id, r]));
        const base = computeBasePermissions(guildId, guild.owner_id, this.#userId, me.roles, roles);
        if (!channelId) return base;

        let channel = this.channels.get(channelId);
        if (channel && "parent_id" in channel && isThread(channel) && channel.parent_id) {
            channel = this.channels.get(channel.parent_id);
        }
        if (!channel || !("guild_id" in channel) || channel.guild_id !== guildId) return undefined;
        const overwrites = "permission_overwrites" in channel ? channel.permission_overwrites ?? [] : [];
        return applyOverwrites(base, guildId, this.#userId, me.roles, overwrites);
    }

    /** Whether the bot has all of the given permissions (e.g. `PermissionFlagsBits.SendMessages`). */
    can(permission: bigint, guildId: Snowflake, channelId?: Snowflake): boolean {
        const permissions = this.permissions(guildId, channelId);
        return permissions !== undefined && (permissions & permission) === permission;
    }

    // --- fetch-through ---------------------------------------------------------------------------

    /** Returns the cached guild, or fetches (and caches) it. */
    async fetchGuild(guildId: Snowflake): Promise<CachedGuild> {
        const cached = this.guilds.get(guildId);
        if (cached) return cached;
        const guild = await this.#requireApi().guilds.get(guildId);
        this.#setGuild(guild);
        return this.guilds.get(guildId)!;
    }

    /** Returns the cached channel, or fetches (and caches) it. */
    async fetchChannel(channelId: Snowflake): Promise<APIChannel> {
        const cached = this.channels.get(channelId);
        if (cached) return cached;
        const channel = await this.#requireApi().channels.get(channelId);
        this.#setChannel(channel);
        return channel;
    }

    /** Clears everything. */
    clear(): void {
        this.guilds.clear();
        this.unavailableGuilds.clear();
        this.channels.clear();
        this.roles.clear();
        this.members.clear();
        this.#messages.clear();
        this.#guildChannels.clear();
        this.#guildRoles.clear();
    }

    // --- event handling --------------------------------------------------------------------------

    /** Applies a gateway dispatch to the cache. Called by the client for every event. */
    handle(payload: GatewayDispatchPayload): void {
        switch (payload.t) {
            case GatewayDispatchEvents.Ready: {
                // A fresh session: anything cached before may be stale.
                this.clear();
                this.#userId = payload.d.user.id;
                for (const g of payload.d.guilds) this.unavailableGuilds.add(g.id);
                break;
            }

            case GatewayDispatchEvents.GuildCreate: {
                const d = payload.d;
                if (d.unavailable) {
                    this.unavailableGuilds.add(d.id);
                    break;
                }
                this.#removeGuild(d.id); // replace, don't merge: GUILD_CREATE is a full snapshot
                const {
                    channels,
                    threads,
                    members,
                    presences: _presences,
                    voice_states: _voiceStates,
                    stage_instances: _stageInstances,
                    guild_scheduled_events: _events,
                    soundboard_sounds: _sounds,
                    ...rest
                } = d;
                this.#setGuild(rest as APIGuild);
                for (const c of [...channels ?? [], ...threads ?? []]) this.#setChannel({ ...c, guild_id: d.id });
                const me = members?.find((m) => m.user.id === this.#userId);
                if (me) this.members.set(d.id, me);
                break;
            }
            case GatewayDispatchEvents.GuildUpdate: {
                const existing = this.guilds.get(payload.d.id);
                const { roles, ...rest } = payload.d;
                this.guilds.set(payload.d.id, { ...existing, ...rest } as CachedGuild);
                for (const role of roles ?? []) this.#setRole(payload.d.id, role);
                break;
            }
            case GatewayDispatchEvents.GuildDelete: {
                if (payload.d.unavailable) this.unavailableGuilds.add(payload.d.id);
                else this.#removeGuild(payload.d.id);
                break;
            }
            case GatewayDispatchEvents.GuildEmojisUpdate: {
                const guild = this.guilds.get(payload.d.guild_id);
                if (guild) guild.emojis = payload.d.emojis;
                break;
            }
            case GatewayDispatchEvents.GuildStickersUpdate: {
                const guild = this.guilds.get(payload.d.guild_id);
                if (guild) guild.stickers = payload.d.stickers;
                break;
            }

            case GatewayDispatchEvents.GuildRoleCreate:
            case GatewayDispatchEvents.GuildRoleUpdate:
                this.#setRole(payload.d.guild_id, payload.d.role);
                break;
            case GatewayDispatchEvents.GuildRoleDelete:
                this.roles.delete(payload.d.role_id);
                this.#guildRoles.get(payload.d.guild_id)?.delete(payload.d.role_id);
                break;

            case GatewayDispatchEvents.GuildMemberUpdate: {
                // Sent for the bot's own member even without the GuildMembers intent.
                if (payload.d.user.id !== this.#userId) break;
                const existing = this.members.get(payload.d.guild_id);
                const { guild_id: _, ...member } = payload.d;
                this.members.set(payload.d.guild_id, { ...existing, ...member } as APIGuildMember);
                break;
            }

            case GatewayDispatchEvents.ChannelCreate:
            case GatewayDispatchEvents.ChannelUpdate:
            case GatewayDispatchEvents.ThreadCreate:
                this.#setChannel(payload.d);
                break;
            case GatewayDispatchEvents.ThreadUpdate: {
                const existing = this.channels.get(payload.d.id);
                this.#setChannel({ ...existing, ...payload.d } as APIChannel);
                break;
            }
            case GatewayDispatchEvents.ChannelDelete:
            case GatewayDispatchEvents.ThreadDelete:
                this.#removeChannel(payload.d.id);
                break;
            case GatewayDispatchEvents.ThreadListSync: {
                const { guild_id, channel_ids, threads } = payload.d;
                // Threads for the synced parents (or the whole guild) are replaced by this list.
                for (const channel of this.guildChannels(guild_id)) {
                    if (!isThread(channel)) continue;
                    const parent = "parent_id" in channel ? channel.parent_id : undefined;
                    if (!channel_ids || (parent && channel_ids.includes(parent))) this.#removeChannel(channel.id);
                }
                for (const thread of threads) this.#setChannel({ ...thread, guild_id });
                break;
            }

            case GatewayDispatchEvents.MessageCreate: {
                if (this.#messagesPerChannel <= 0) break;
                const { channel_id } = payload.d;
                let messages = this.#messages.get(channel_id);
                if (!messages) this.#messages.set(channel_id, messages = new Map());
                messages.set(payload.d.id, payload.d);
                while (messages.size > this.#messagesPerChannel) messages.delete(messages.keys().next().value!);
                break;
            }
            case GatewayDispatchEvents.MessageUpdate: {
                const messages = this.#messages.get(payload.d.channel_id);
                const existing = messages?.get(payload.d.id);
                if (messages && existing) messages.set(payload.d.id, { ...existing, ...payload.d } as APIMessage);
                break;
            }
            case GatewayDispatchEvents.MessageDelete:
                this.#messages.get(payload.d.channel_id)?.delete(payload.d.id);
                break;
            case GatewayDispatchEvents.MessageDeleteBulk: {
                const messages = this.#messages.get(payload.d.channel_id);
                for (const id of payload.d.ids) messages?.delete(id);
                break;
            }
        }
    }

    // --- internals -------------------------------------------------------------------------------

    #requireApi(): API {
        if (!this.#api) throw new Error("This cache has no API attached; fetch helpers are unavailable");
        return this.#api;
    }

    #setGuild(guild: APIGuild): void {
        const { roles, ...rest } = guild;
        this.guilds.set(guild.id, rest as CachedGuild);
        this.unavailableGuilds.delete(guild.id);
        for (const role of roles ?? []) this.#setRole(guild.id, role);
    }

    #setRole(guildId: Snowflake, role: APIRole): void {
        this.roles.set(role.id, { ...role, guild_id: guildId });
        let ids = this.#guildRoles.get(guildId);
        if (!ids) this.#guildRoles.set(guildId, ids = new Set());
        ids.add(role.id);
    }

    #setChannel(channel: APIChannel): void {
        this.channels.set(channel.id, channel);
        const guildId = "guild_id" in channel ? channel.guild_id : undefined;
        if (!guildId) return;
        let ids = this.#guildChannels.get(guildId);
        if (!ids) this.#guildChannels.set(guildId, ids = new Set());
        ids.add(channel.id);
    }

    #removeChannel(channelId: Snowflake): void {
        const channel = this.channels.get(channelId);
        this.channels.delete(channelId);
        this.#messages.delete(channelId);
        const guildId = channel && "guild_id" in channel ? channel.guild_id : undefined;
        if (guildId) this.#guildChannels.get(guildId)?.delete(channelId);
    }

    #removeGuild(guildId: Snowflake): void {
        for (const id of this.#guildChannels.get(guildId) ?? []) {
            this.channels.delete(id);
            this.#messages.delete(id);
        }
        for (const id of this.#guildRoles.get(guildId) ?? []) this.roles.delete(id);
        this.#guildChannels.delete(guildId);
        this.#guildRoles.delete(guildId);
        this.guilds.delete(guildId);
        this.members.delete(guildId);
        this.unavailableGuilds.delete(guildId);
    }
}

const THREAD_TYPES = new Set<ChannelType>([
    ChannelType.AnnouncementThread,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
]);

function isThread(channel: APIChannel): boolean {
    return THREAD_TYPES.has(channel.type);
}
