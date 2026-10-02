import {
    type RESTDeleteAPICurrentUserGuildResult,
    type RESTDeleteAPIGuildBanResult,
    type RESTDeleteAPIGuildEmojiResult,
    type RESTDeleteAPIGuildMemberResult,
    type RESTDeleteAPIGuildMemberRoleResult,
    type RESTDeleteAPIGuildRoleResult,
    type RESTGetAPIAuditLogQuery,
    type RESTGetAPIAuditLogResult,
    type RESTGetAPIGuildBanResult,
    type RESTGetAPIGuildBansQuery,
    type RESTGetAPIGuildBansResult,
    type RESTGetAPIGuildChannelsResult,
    type RESTGetAPIGuildEmojisResult,
    type RESTGetAPIGuildInvitesResult,
    type RESTGetAPIGuildMemberResult,
    type RESTGetAPIGuildMembersQuery,
    type RESTGetAPIGuildMembersResult,
    type RESTGetAPIGuildMembersSearchQuery,
    type RESTGetAPIGuildMembersSearchResult,
    type RESTGetAPIGuildQuery,
    type RESTGetAPIGuildResult,
    type RESTGetAPIGuildRoleResult,
    type RESTGetAPIGuildRolesResult,
    type RESTGetAPIGuildThreadsResult,
    type RESTGetAPIGuildWebhooksResult,
    type RESTPatchAPICurrentGuildMemberJSONBody,
    type RESTPatchAPICurrentGuildMemberResult,
    type RESTPatchAPIGuildChannelPositionsJSONBody,
    type RESTPatchAPIGuildChannelPositionsResult,
    type RESTPatchAPIGuildJSONBody,
    type RESTPatchAPIGuildMemberJSONBody,
    type RESTPatchAPIGuildMemberResult,
    type RESTPatchAPIGuildResult,
    type RESTPatchAPIGuildRoleJSONBody,
    type RESTPatchAPIGuildRolePositionsJSONBody,
    type RESTPatchAPIGuildRolePositionsResult,
    type RESTPatchAPIGuildRoleResult,
    type RESTPostAPIGuildBulkBanJSONBody,
    type RESTPostAPIGuildBulkBanResult,
    type RESTPostAPIGuildChannelJSONBody,
    type RESTPostAPIGuildChannelResult,
    type RESTPostAPIGuildEmojiJSONBody,
    type RESTPostAPIGuildEmojiResult,
    type RESTPostAPIGuildRoleJSONBody,
    type RESTPostAPIGuildRoleResult,
    type RESTPutAPIGuildBanJSONBody,
    type RESTPutAPIGuildBanResult,
    type RESTPutAPIGuildMemberRoleResult,
    Routes,
    type Snowflake,
} from "discord-api-types/v10";
import type { RestClient } from "../rest/rest.ts";
import { query, type ReasonOptions } from "./shared.ts";

/** Guild, member, role, ban, emoji and audit log endpoints. */
export class GuildsAPI {
    readonly #rest: RestClient;

    /** Creates the guild API group. Usually accessed as `client.api.guilds`. */
    constructor(rest: RestClient) {
        this.#rest = rest;
    }

    // --- guild ---------------------------------------------------------------------------------

    /** Gets a guild, optionally with approximate member and presence counts. */
    async get(guildId: Snowflake, options?: RESTGetAPIGuildQuery): Promise<RESTGetAPIGuildResult> {
        return await this.#rest.get(Routes.guild(guildId), { query: query(options) });
    }

    /** Edits a guild's settings. */
    async edit(
        guildId: Snowflake,
        body: RESTPatchAPIGuildJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIGuildResult> {
        return await this.#rest.patch(Routes.guild(guildId), { body, reason: options.reason });
    }

    /** Lists a guild's channels. */
    async getChannels(guildId: Snowflake): Promise<RESTGetAPIGuildChannelsResult> {
        return await this.#rest.get(Routes.guildChannels(guildId));
    }

    /** Creates a channel in a guild. */
    async createChannel(
        guildId: Snowflake,
        body: RESTPostAPIGuildChannelJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIGuildChannelResult> {
        return await this.#rest.post(Routes.guildChannels(guildId), { body, reason: options.reason });
    }

    /** Modifies the positions of a set of channels. */
    async editChannelPositions(
        guildId: Snowflake,
        body: RESTPatchAPIGuildChannelPositionsJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIGuildChannelPositionsResult> {
        return await this.#rest.patch(Routes.guildChannels(guildId), { body, reason: options.reason });
    }

    // --- members -------------------------------------------------------------------------------

    /** Gets a guild member. */
    async getMember(guildId: Snowflake, userId: Snowflake): Promise<RESTGetAPIGuildMemberResult> {
        return await this.#rest.get(Routes.guildMember(guildId, userId));
    }

    /** Lists a guild's members. */
    async listMembers(
        guildId: Snowflake,
        options?: RESTGetAPIGuildMembersQuery,
    ): Promise<RESTGetAPIGuildMembersResult> {
        return await this.#rest.get(Routes.guildMembers(guildId), { query: query(options) });
    }

    /** Searches a guild's members by name or nickname. */
    async searchMembers(
        guildId: Snowflake,
        options?: RESTGetAPIGuildMembersSearchQuery,
    ): Promise<RESTGetAPIGuildMembersSearchResult> {
        return await this.#rest.get(Routes.guildMembersSearch(guildId), { query: query(options) });
    }

    /** Edits a guild member. */
    async editMember(
        guildId: Snowflake,
        userId: Snowflake,
        body: RESTPatchAPIGuildMemberJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIGuildMemberResult> {
        return await this.#rest.patch(Routes.guildMember(guildId, userId), { body, reason: options.reason });
    }

    /** Edits the bot's own guild member (nick, avatar, banner). */
    async editCurrentMember(
        guildId: Snowflake,
        body: RESTPatchAPICurrentGuildMemberJSONBody,
    ): Promise<RESTPatchAPICurrentGuildMemberResult> {
        return await this.#rest.patch(Routes.guildMember(guildId, "@me"), { body });
    }

    /** Adds a role to a guild member. */
    async addMemberRole(
        guildId: Snowflake,
        userId: Snowflake,
        roleId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTPutAPIGuildMemberRoleResult> {
        return await this.#rest.put(Routes.guildMemberRole(guildId, userId, roleId), { reason: options.reason });
    }

    /** Removes a role from a guild member. */
    async removeMemberRole(
        guildId: Snowflake,
        userId: Snowflake,
        roleId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTDeleteAPIGuildMemberRoleResult> {
        return await this.#rest.delete(Routes.guildMemberRole(guildId, userId, roleId), { reason: options.reason });
    }

    /** Kicks a guild member. */
    async removeMember(
        guildId: Snowflake,
        userId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTDeleteAPIGuildMemberResult> {
        return await this.#rest.delete(Routes.guildMember(guildId, userId), { reason: options.reason });
    }

    // --- bans ----------------------------------------------------------------------------------

    /** Lists a guild's bans. */
    async getBans(guildId: Snowflake, options?: RESTGetAPIGuildBansQuery): Promise<RESTGetAPIGuildBansResult> {
        return await this.#rest.get(Routes.guildBans(guildId), { query: query(options) });
    }

    /** Gets a guild's ban for a user. */
    async getBan(guildId: Snowflake, userId: Snowflake): Promise<RESTGetAPIGuildBanResult> {
        return await this.#rest.get(Routes.guildBan(guildId, userId));
    }

    /** Bans a user, optionally deleting recent messages. */
    async ban(
        guildId: Snowflake,
        userId: Snowflake,
        body: RESTPutAPIGuildBanJSONBody = {},
        options: ReasonOptions = {},
    ): Promise<RESTPutAPIGuildBanResult> {
        return await this.#rest.put(Routes.guildBan(guildId, userId), { body, reason: options.reason });
    }

    /** Removes a guild ban for a user. */
    async unban(
        guildId: Snowflake,
        userId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTDeleteAPIGuildBanResult> {
        return await this.#rest.delete(Routes.guildBan(guildId, userId), { reason: options.reason });
    }

    /** Bans up to 200 users at once. */
    async bulkBan(
        guildId: Snowflake,
        body: RESTPostAPIGuildBulkBanJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIGuildBulkBanResult> {
        return await this.#rest.post(Routes.guildBulkBan(guildId), { body, reason: options.reason });
    }

    // --- roles ---------------------------------------------------------------------------------

    /** Lists a guild's roles. */
    async getRoles(guildId: Snowflake): Promise<RESTGetAPIGuildRolesResult> {
        return await this.#rest.get(Routes.guildRoles(guildId));
    }

    /** Gets a guild role. */
    async getRole(guildId: Snowflake, roleId: Snowflake): Promise<RESTGetAPIGuildRoleResult> {
        return await this.#rest.get(Routes.guildRole(guildId, roleId));
    }

    /** Creates a guild role. */
    async createRole(
        guildId: Snowflake,
        body: RESTPostAPIGuildRoleJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIGuildRoleResult> {
        return await this.#rest.post(Routes.guildRoles(guildId), { body, reason: options.reason });
    }

    /** Edits a guild role. */
    async editRole(
        guildId: Snowflake,
        roleId: Snowflake,
        body: RESTPatchAPIGuildRoleJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIGuildRoleResult> {
        return await this.#rest.patch(Routes.guildRole(guildId, roleId), { body, reason: options.reason });
    }

    /** Modifies the positions of a set of roles. */
    async editRolePositions(
        guildId: Snowflake,
        body: RESTPatchAPIGuildRolePositionsJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIGuildRolePositionsResult> {
        return await this.#rest.patch(Routes.guildRoles(guildId), { body, reason: options.reason });
    }

    /** Deletes a guild role. */
    async deleteRole(
        guildId: Snowflake,
        roleId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTDeleteAPIGuildRoleResult> {
        return await this.#rest.delete(Routes.guildRole(guildId, roleId), { reason: options.reason });
    }

    // --- audit log, invites, webhooks, threads, emojis -----------------------------------------

    /** Gets a guild's audit log. */
    async getAuditLog(guildId: Snowflake, options?: RESTGetAPIAuditLogQuery): Promise<RESTGetAPIAuditLogResult> {
        return await this.#rest.get(Routes.guildAuditLog(guildId), { query: query(options) });
    }

    /** Lists a guild's invites. */
    async getInvites(guildId: Snowflake): Promise<RESTGetAPIGuildInvitesResult> {
        return await this.#rest.get(Routes.guildInvites(guildId));
    }

    /** Lists a guild's webhooks. */
    async getWebhooks(guildId: Snowflake): Promise<RESTGetAPIGuildWebhooksResult> {
        return await this.#rest.get(Routes.guildWebhooks(guildId));
    }

    /** Lists a guild's active threads. */
    async getActiveThreads(guildId: Snowflake): Promise<RESTGetAPIGuildThreadsResult> {
        return await this.#rest.get(Routes.guildActiveThreads(guildId));
    }

    /** Lists a guild's emojis. */
    async getEmojis(guildId: Snowflake): Promise<RESTGetAPIGuildEmojisResult> {
        return await this.#rest.get(Routes.guildEmojis(guildId));
    }

    /** Creates a guild emoji. */
    async createEmoji(
        guildId: Snowflake,
        body: RESTPostAPIGuildEmojiJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIGuildEmojiResult> {
        return await this.#rest.post(Routes.guildEmojis(guildId), { body, reason: options.reason });
    }

    /** Deletes a guild emoji. */
    async deleteEmoji(
        guildId: Snowflake,
        emojiId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTDeleteAPIGuildEmojiResult> {
        return await this.#rest.delete(Routes.guildEmoji(guildId, emojiId), { reason: options.reason });
    }

    /** Leaves a guild. */
    async leave(guildId: Snowflake): Promise<RESTDeleteAPICurrentUserGuildResult> {
        return await this.#rest.delete(Routes.userGuild(guildId));
    }
}
