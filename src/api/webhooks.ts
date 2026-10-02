import {
    type RESTDeleteAPIWebhookResult,
    type RESTDeleteAPIWebhookWithTokenMessageResult,
    type RESTGetAPIWebhookResult,
    type RESTGetAPIWebhookWithTokenMessageQuery,
    type RESTGetAPIWebhookWithTokenMessageResult,
    type RESTGetAPIWebhookWithTokenResult,
    type RESTPatchAPIWebhookJSONBody,
    type RESTPatchAPIWebhookResult,
    type RESTPatchAPIWebhookWithTokenMessageJSONBody,
    type RESTPatchAPIWebhookWithTokenMessageResult,
    type RESTPostAPIWebhookWithTokenJSONBody,
    type RESTPostAPIWebhookWithTokenQuery,
    type RESTPostAPIWebhookWithTokenResult,
    type RESTPostAPIWebhookWithTokenWaitResult,
    Routes,
    type Snowflake,
} from "discord-api-types/v10";
import type { RestClient } from "../rest/rest.ts";
import { type MessagePayload, messageRequest, query, type ReasonOptions } from "./shared.ts";

/** Webhook endpoints, with and without a token. */
export class WebhooksAPI {
    readonly #rest: RestClient;

    /** Creates the webhook API group. Usually accessed as `client.api.webhooks`. */
    constructor(rest: RestClient) {
        this.#rest = rest;
    }

    /** Gets a webhook by ID. */
    async get(webhookId: Snowflake): Promise<RESTGetAPIWebhookResult> {
        return await this.#rest.get(Routes.webhook(webhookId));
    }

    /** Gets a webhook by ID and token (no authentication required). */
    async getWithToken(webhookId: Snowflake, token: string): Promise<RESTGetAPIWebhookWithTokenResult> {
        return await this.#rest.get(Routes.webhook(webhookId, token), { auth: false });
    }

    /** Edits a webhook. */
    async edit(
        webhookId: Snowflake,
        body: RESTPatchAPIWebhookJSONBody,
        options: ReasonOptions = {},
    ): Promise<RESTPatchAPIWebhookResult> {
        return await this.#rest.patch(Routes.webhook(webhookId), { body, reason: options.reason });
    }

    /** Deletes a webhook. */
    async delete(webhookId: Snowflake, options: ReasonOptions = {}): Promise<RESTDeleteAPIWebhookResult> {
        return await this.#rest.delete(Routes.webhook(webhookId), { reason: options.reason });
    }

    /**
     * Executes a webhook. Set `wait` to receive the created message; `thread_id` posts into a thread.
     * @example
     * ```ts
     * await client.api.webhooks.execute(id, token, "Deployed!", { wait: true });
     * ```
     */
    async execute(
        webhookId: Snowflake,
        token: string,
        payload: MessagePayload<RESTPostAPIWebhookWithTokenJSONBody>,
        options: RESTPostAPIWebhookWithTokenQuery = {},
    ): Promise<RESTPostAPIWebhookWithTokenWaitResult | RESTPostAPIWebhookWithTokenResult> {
        return await this.#rest.post(Routes.webhook(webhookId, token), {
            ...messageRequest(payload),
            query: query(options),
            auth: false,
        });
    }

    /** Gets a message previously sent by a webhook. */
    async getMessage(
        webhookId: Snowflake,
        token: string,
        messageId: Snowflake,
        options?: RESTGetAPIWebhookWithTokenMessageQuery,
    ): Promise<RESTGetAPIWebhookWithTokenMessageResult> {
        return await this.#rest.get(Routes.webhookMessage(webhookId, token, messageId), {
            query: query(options),
            auth: false,
        });
    }

    /** Edits a message previously sent by a webhook. */
    async editMessage(
        webhookId: Snowflake,
        token: string,
        messageId: Snowflake,
        payload: MessagePayload<RESTPatchAPIWebhookWithTokenMessageJSONBody>,
    ): Promise<RESTPatchAPIWebhookWithTokenMessageResult> {
        return await this.#rest.patch(Routes.webhookMessage(webhookId, token, messageId), {
            ...messageRequest(payload),
            auth: false,
        });
    }

    /** Deletes a message previously sent by a webhook. */
    async deleteMessage(
        webhookId: Snowflake,
        token: string,
        messageId: Snowflake,
        options: ReasonOptions = {},
    ): Promise<RESTDeleteAPIWebhookWithTokenMessageResult> {
        return await this.#rest.delete(Routes.webhookMessage(webhookId, token, messageId), {
            reason: options.reason,
            auth: false,
        });
    }
}
