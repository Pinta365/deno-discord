/**
 * A minimal, modern Discord library for Deno: gateway bots, HTTP interactions and a rate-limited REST client.
 *
 * Discord API types come from `discord-api-types` and are re-exported from `@pinta365/discordbot/types`.
 *
 * @example
 * ```ts
 * import { Client, GatewayIntentBits } from "@pinta365/discordbot";
 *
 * const client = new Client({ token: Deno.env.get("TOKEN")!, intents: [GatewayIntentBits.Guilds] });
 * client.on("INTERACTION_CREATE", async (interaction) => {
 *     if (interaction.commandName === "ping") await interaction.reply("Pong!");
 * });
 * await client.connect();
 * ```
 * @module
 */
export { Client, type ClientEvents, type ClientOptions } from "./src/client.ts";
export { Shard, type ShardOptions, type ShardStatus } from "./src/gateway/shard.ts";
export { type RawFile, type RequestOptions, RestClient, type RestOptions } from "./src/rest/rest.ts";
export { DiscordAPIError } from "./src/rest/errors.ts";
export { API } from "./src/api/api.ts";
export { ApplicationsAPI } from "./src/api/applications.ts";
export { ChannelsAPI } from "./src/api/channels.ts";
export { GuildsAPI } from "./src/api/guilds.ts";
export { UsersAPI } from "./src/api/users.ts";
export { WebhooksAPI } from "./src/api/webhooks.ts";
export {
    type InitialResponder,
    Interaction,
    type OptionValue,
    type ReplyOptions,
} from "./src/interactions/interaction.ts";
export { createInteractionHandler, type InteractionHandlerOptions, verify } from "./src/interactions/http.ts";
export { Cache, type CachedGuild, type CachedRole, type CacheOptions } from "./src/cache/cache.ts";
export { applyOverwrites, computeBasePermissions } from "./src/cache/permissions.ts";
export { Emitter, type EventMap, type Listener } from "./src/events.ts";
export { consoleLogHandler, Logger, type LoggerOptions, type LogHandler, LogLevel } from "./src/logger.ts";
export { VERSION } from "./src/version.ts";

// The most commonly needed runtime enums and helpers from discord-api-types.
export {
    ActivityType,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ButtonStyle,
    ComponentType,
    GatewayDispatchEvents,
    GatewayIntentBits,
    InteractionContextType,
    InteractionType,
    MessageFlags,
    PermissionFlagsBits,
    PresenceUpdateStatus,
    Routes,
    TextInputStyle,
} from "discord-api-types/v10";
