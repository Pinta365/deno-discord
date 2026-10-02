import type { RestClient } from "../rest/rest.ts";
import { ApplicationsAPI } from "./applications.ts";
import { ChannelsAPI } from "./channels.ts";
import { GuildsAPI } from "./guilds.ts";
import { UsersAPI } from "./users.ts";
import { WebhooksAPI } from "./webhooks.ts";

/**
 * Typed convenience wrappers over common REST endpoints, grouped by resource.
 * Available as `client.api`, or create one yourself with `new API(rest)` (e.g. for HTTP-only bots).
 *
 * Anything not covered here can be called directly with `rest.get/post/...` and `Routes`.
 */
export class API {
    /** Channels, messages, reactions, pins, threads. */
    readonly channels: ChannelsAPI;

    /** Guilds, members, roles, bans, emojis, audit log. */
    readonly guilds: GuildsAPI;

    /** Users and DMs. */
    readonly users: UsersAPI;

    /** Applications, commands, entitlements, SKUs. */
    readonly applications: ApplicationsAPI;

    /** Webhooks, with and without a token. */
    readonly webhooks: WebhooksAPI;

    /** Creates the API wrapper around a REST client. */
    constructor(rest: RestClient) {
        this.channels = new ChannelsAPI(rest);
        this.guilds = new GuildsAPI(rest);
        this.users = new UsersAPI(rest);
        this.applications = new ApplicationsAPI(rest);
        this.webhooks = new WebhooksAPI(rest);
    }
}
