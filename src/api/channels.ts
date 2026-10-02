import {
    type RESTDeleteAPIChannelResult,
    type RESTGetAPIChannelMessageReactionUsersQuery,
    type RESTGetAPIChannelMessageReactionUsersResult,
    type RESTGetAPIChannelMessageResult,
    type RESTGetAPIChannelMessagesPinsQuery,
    type RESTGetAPIChannelMessagesPinsResult,
    type RESTGetAPIChannelMessagesQuery,
    type RESTGetAPIChannelMessagesResult,
    type RESTGetAPIChannelResult,
    type RESTPatchAPIChannelJSONBody,
    type RESTPatchAPIChannelMessageJSONBody,
    type RESTPatchAPIChannelMessageResult,
    type RESTPatchAPIChannelResult,
    type RESTPostAPIChannelInviteJSONBody,
    type RESTPostAPIChannelInviteResult,
    type RESTPostAPIChannelMessageCrosspostResult,
    type RESTPostAPIChannelMessageJSONBody,
    type RESTPostAPIChannelMessageResult,
    type RESTPostAPIChannelMessagesThreadsJSONBody,
    type RESTPostAPIChannelMessagesThreadsResult,
    type RESTPostAPIChannelThreadsJSONBody,
    type RESTPostAPIChannelThreadsResult,
    type RESTPostAPIChannelWebhookJSONBody,
    type RESTPostAPIChannelWebhookResult,
    Routes,
    type Snowflake,
} from "discord-api-types/v10";
import type { RestClient } from "../rest/rest.ts";
import { encodeEmoji, type MessagePayload, messageRequest, query, type ReasonOptions } from "./shared.ts";

/** Channel, message, reaction, pin and thread endpoints. */
export class ChannelsAPI {
    readonly #rest: RestClient;

    /** Creates the channel API group. Usually accessed as `client.api.channels`. */
    constructor(rest: RestClient) {
        this.#rest = rest;
    }

    // --- channels ------------------------------------------------------------------------------

    /** Gets a channel. */
    async get(channelId: Snowflake): Promise<RESTGetAPIChannelResult> {
        return await this.#rest.get(Routes.channel(channelId));
    }

    /** Edits a channel's settings. */
    async edit(
        channelId: Snowflake,
        body: RESTPatchAPIChannelJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIChannelResult> {
        return await this.#rest.patch(Routes.channel(channelId), { body, reason: options.reason });
    }

    /** Deletes a channel, or closes a DM. */
    async delete(channelId: Snowflake, options: ReasonOptions = {}): Promise<RESTDeleteAPIChannelResult> {
        return await this.#rest.delete(Routes.channel(channelId), { reason: options.reason });
    }

    /** Shows the typing indicator for ~10 seconds. */
    async triggerTyping(channelId: Snowflake): Promise<void> {
        await this.#rest.post(Routes.channelTyping(channelId));
    }

    // --- messages ------------------------------------------------------------------------------

    /** Lists messages in a channel (newest first). */
    async getMessages(
        channelId: Snowflake,
        options?: RESTGetAPIChannelMessagesQuery,
    ): Promise<RESTGetAPIChannelMessagesResult> {
        return await this.#rest.get(Routes.channelMessages(channelId), { query: query(options) });
    }

    /** Gets a single message. */
    async getMessage(channelId: Snowflake, messageId: Snowflake): Promise<RESTGetAPIChannelMessageResult> {
        return await this.#rest.get(Routes.channelMessage(channelId, messageId));
    }

    /**
     * Sends a message.
     * @example
     * ```ts
     * await client.api.channels.createMessage(channelId, "Hello!");
     * await client.api.channels.createMessage(channelId, { content: "Log", files: [{ name: "log.txt", data: text }] });
     * ```
     */
    async createMessage(
        channelId: Snowflake,
        payload: MessagePayload<RESTPostAPIChannelMessageJSONBody>,
    ): Promise<RESTPostAPIChannelMessageResult> {
        return await this.#rest.post(Routes.channelMessages(channelId), messageRequest(payload));
    }

    /** Edits a message sent by the bot (or suppresses embeds on another user's message). */
    async editMessage(
        channelId: Snowflake,
        messageId: Snowflake,
        payload: MessagePayload<RESTPatchAPIChannelMessageJSONBody>,
    ): Promise<RESTPatchAPIChannelMessageResult> {
        return await this.#rest.patch(Routes.channelMessage(channelId, messageId), messageRequest(payload));
    }

    /** Deletes a message. */
    async deleteMessage(channelId: Snowflake, messageId: Snowflake, options: ReasonOptions = {}): Promise<void> {
        await this.#rest.delete(Routes.channelMessage(channelId, messageId), { reason: options.reason });
    }

    /** Deletes 2–100 messages younger than two weeks. */
    async bulkDeleteMessages(
        channelId: Snowflake,
        messageIds: Snowflake[],
        options: ReasonOptions = {},
    ): Promise<void> {
        await this.#rest.post(Routes.channelBulkDelete(channelId), {
            body: { messages: messageIds },
            reason: options.reason,
        });
    }

    /** Publishes a message in an announcement channel to following channels. */
    async crosspostMessage(
        channelId: Snowflake,
        messageId: Snowflake,
    ): Promise<RESTPostAPIChannelMessageCrosspostResult> {
        return await this.#rest.post(Routes.channelMessageCrosspost(channelId, messageId));
    }

    // --- reactions -----------------------------------------------------------------------------

    /** Reacts to a message as the bot. `emoji` is `"👍"`, `"name:id"` or `"<:name:id>"`. */
    async addReaction(channelId: Snowflake, messageId: Snowflake, emoji: string): Promise<void> {
        await this.#rest.put(Routes.channelMessageOwnReaction(channelId, messageId, encodeEmoji(emoji)));
    }

    /** Removes the bot's own reaction. */
    async removeOwnReaction(channelId: Snowflake, messageId: Snowflake, emoji: string): Promise<void> {
        await this.#rest.delete(Routes.channelMessageOwnReaction(channelId, messageId, encodeEmoji(emoji)));
    }

    /** Removes another user's reaction. */
    async removeUserReaction(
        channelId: Snowflake,
        messageId: Snowflake,
        emoji: string,
        userId: Snowflake,
    ): Promise<void> {
        await this.#rest.delete(Routes.channelMessageUserReaction(channelId, messageId, encodeEmoji(emoji), userId));
    }

    /** Lists users who reacted with an emoji. */
    async getReactions(
        channelId: Snowflake,
        messageId: Snowflake,
        emoji: string,
        options?: RESTGetAPIChannelMessageReactionUsersQuery,
    ): Promise<RESTGetAPIChannelMessageReactionUsersResult> {
        return await this.#rest.get(Routes.channelMessageReaction(channelId, messageId, encodeEmoji(emoji)), {
            query: query(options),
        });
    }

    /** Removes all reactions, or all reactions for one emoji. */
    async removeAllReactions(channelId: Snowflake, messageId: Snowflake, emoji?: string): Promise<void> {
        const route = emoji
            ? Routes.channelMessageReaction(channelId, messageId, encodeEmoji(emoji))
            : Routes.channelMessageAllReactions(channelId, messageId);
        await this.#rest.delete(route);
    }

    // --- pins ----------------------------------------------------------------------------------

    /** Lists pinned messages. */
    async getPins(
        channelId: Snowflake,
        options?: RESTGetAPIChannelMessagesPinsQuery,
    ): Promise<RESTGetAPIChannelMessagesPinsResult> {
        return await this.#rest.get(Routes.channelMessagesPins(channelId), { query: query(options) });
    }

    /** Pins a message. */
    async pinMessage(channelId: Snowflake, messageId: Snowflake, options: ReasonOptions = {}): Promise<void> {
        await this.#rest.put(Routes.channelMessagesPin(channelId, messageId), { reason: options.reason });
    }

    /** Unpins a message. */
    async unpinMessage(channelId: Snowflake, messageId: Snowflake, options: ReasonOptions = {}): Promise<void> {
        await this.#rest.delete(Routes.channelMessagesPin(channelId, messageId), { reason: options.reason });
    }

    // --- threads, invites, webhooks ------------------------------------------------------------

    /** Starts a thread from an existing message. */
    async createThreadFromMessage(
        channelId: Snowflake,
        messageId: Snowflake,
        body: RESTPostAPIChannelMessagesThreadsJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIChannelMessagesThreadsResult> {
        return await this.#rest.post(Routes.threads(channelId, messageId), { body, reason: options.reason });
    }

    /** Starts a thread without a message (or a forum/media post). */
    async createThread(
        channelId: Snowflake,
        body: RESTPostAPIChannelThreadsJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIChannelThreadsResult> {
        return await this.#rest.post(Routes.threads(channelId), { body, reason: options.reason });
    }

    /** Joins a thread as the bot. */
    async joinThread(threadId: Snowflake): Promise<void> {
        await this.#rest.put(Routes.threadMembers(threadId, "@me"));
    }

    /** Leaves a thread. */
    async leaveThread(threadId: Snowflake): Promise<void> {
        await this.#rest.delete(Routes.threadMembers(threadId, "@me"));
    }

    /** Creates an invite. */
    async createInvite(
        channelId: Snowflake,
        body: RESTPostAPIChannelInviteJSONBody = {},
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIChannelInviteResult> {
        return await this.#rest.post(Routes.channelInvites(channelId), { body, reason: options.reason });
    }

    /** Creates a webhook in the channel. */
    async createWebhook(
        channelId: Snowflake,
        body: RESTPostAPIChannelWebhookJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPostAPIChannelWebhookResult> {
        return await this.#rest.post(Routes.channelWebhooks(channelId), { body, reason: options.reason });
    }
}
