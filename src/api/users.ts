import {
    type RESTGetAPICurrentUserGuildsQuery,
    type RESTGetAPICurrentUserGuildsResult,
    type RESTGetAPICurrentUserResult,
    type RESTGetAPIUserResult,
    type RESTPatchAPICurrentUserJSONBody,
    type RESTPatchAPICurrentUserResult,
    type RESTPostAPIChannelMessageJSONBody,
    type RESTPostAPIChannelMessageResult,
    type RESTPostAPICurrentUserCreateDMChannelJSONBody,
    type RESTPostAPICurrentUserCreateDMChannelResult,
    Routes,
    type Snowflake,
} from "discord-api-types/v10";
import type { RestClient } from "../rest/rest.ts";
import { type MessagePayload, messageRequest, query } from "./shared.ts";

/** User, current-user and DM endpoints. */
export class UsersAPI {
    readonly #rest: RestClient;

    /** Creates the user API group. Usually accessed as `client.api.users`. */
    constructor(rest: RestClient) {
        this.#rest = rest;
    }

    /** Gets the bot's own user. */
    async getCurrent(): Promise<RESTGetAPICurrentUserResult> {
        return await this.#rest.get(Routes.user("@me"));
    }

    /** Gets a user by ID. */
    async get(userId: Snowflake): Promise<RESTGetAPIUserResult> {
        return await this.#rest.get(Routes.user(userId));
    }

    /** Edits the bot's own user. */
    async editCurrent(body: RESTPatchAPICurrentUserJSONBody): Promise<RESTPatchAPICurrentUserResult> {
        return await this.#rest.patch(Routes.user("@me"), { body });
    }

    /** Lists the guilds the bot is a member of. */
    async getCurrentGuilds(options?: RESTGetAPICurrentUserGuildsQuery): Promise<RESTGetAPICurrentUserGuildsResult> {
        return await this.#rest.get(Routes.userGuilds(), { query: query(options) });
    }

    /** Opens (or returns the existing) DM channel with a user. */
    async createDM(userId: Snowflake): Promise<RESTPostAPICurrentUserCreateDMChannelResult> {
        const body: RESTPostAPICurrentUserCreateDMChannelJSONBody = { recipient_id: userId };
        return await this.#rest.post(Routes.userChannels(), { body });
    }

    /** Opens a DM channel with a user and sends a message to it. */
    async sendDM(
        userId: Snowflake,
        payload: MessagePayload<RESTPostAPIChannelMessageJSONBody>,
    ): Promise<RESTPostAPIChannelMessageResult> {
        const channel = await this.createDM(userId);
        return await this.#rest.post(Routes.channelMessages(channel.id), messageRequest(payload));
    }
}
