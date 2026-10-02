import {
    type APIUser,
    GatewayDispatchEvents,
    type GatewayDispatchPayload,
    type GatewayPresenceUpdateData,
    type GatewayReadyDispatchData,
    type RESTGetAPIGatewayBotResult,
    Routes,
} from "discord-api-types/v10";
import { API } from "./api/api.ts";
import { Cache, type CacheOptions } from "./cache/cache.ts";
import { Emitter } from "./events.ts";
import { Shard } from "./gateway/shard.ts";
import { Interaction } from "./interactions/interaction.ts";
import { Logger, type LoggerOptions } from "./logger.ts";
import { RestClient, type RestOptions } from "./rest/rest.ts";

type DispatchData = { [P in GatewayDispatchPayload as `${P["t"]}`]: P["d"] };

/**
 * Events emitted by {@link Client}.
 *
 * Every gateway dispatch is emitted under its Discord name (e.g. `"MESSAGE_CREATE"`, or
 * `GatewayDispatchEvents.MessageCreate`) with its typed payload and the shard ID.
 * `INTERACTION_CREATE` is emitted with an {@link Interaction} wrapper instead of the raw payload.
 */
export type ClientEvents =
    & {
        [K in Exclude<keyof DispatchData, "INTERACTION_CREATE">]: [data: DispatchData[K], shardId: number];
    }
    & {
        INTERACTION_CREATE: [interaction: Interaction, shardId: number];
        /** Every dispatch, before it is emitted under its own name. */
        raw: [payload: GatewayDispatchPayload, shardId: number];
        /** A shard received READY or RESUMED. */
        shardReady: [shardId: number];
        /** A shard failed permanently (bad token, disallowed intents, ...). */
        error: [error: Error, shardId: number];
    };

/** Options for {@link Client}. */
export interface ClientOptions {
    /** Bot token. */
    token: string;
    /** Gateway intents, as a bitfield or a list of `GatewayIntentBits`. */
    intents: number | number[];
    /** Number of shards, or `"auto"` to use Discord's recommendation. Defaults to `"auto"`. */
    shards?: number | "auto";
    /** Initial presence. */
    presence?: GatewayPresenceUpdateData;
    /** Use zlib-stream gateway compression. Defaults to `true`. */
    compress?: boolean;
    /** Member count at which offline members are omitted from GUILD_CREATE (50–250). */
    largeThreshold?: number;
    /** API version. Defaults to 10. */
    apiVersion?: number;
    /** Logging level and handler. */
    logger?: LoggerOptions;
    /**
     * Enable the in-memory cache of guilds, channels, roles and the bot's own members (`client.cache`).
     * Pass options to also cache messages. Defaults to `false`.
     */
    cache?: boolean | CacheOptions;
    /** Extra REST options. */
    rest?: Omit<RestOptions, "token" | "logger" | "apiVersion">;
}

/**
 * A Discord bot client: gateway connection(s), a REST client, and typed events.
 *
 * @example
 * ```ts
 * const client = new Client({ token, intents: GatewayIntentBits.Guilds });
 * client.on("INTERACTION_CREATE", async (i) => {
 *     if (i.commandName === "ping") await i.reply("Pong!");
 * });
 * await client.connect();
 * ```
 */
export class Client extends Emitter<ClientEvents> {
    /** REST client, authenticated with the bot token. */
    readonly rest: RestClient;
    /** Typed convenience wrappers for common REST endpoints. */
    readonly api: API;
    /**
     * The cache, if enabled with the `cache` option. It is updated before listeners run,
     * so handlers see the new state.
     */
    readonly cache: Cache | null;
    /** Active shards by ID. */
    readonly shards: Map<number, Shard> = new Map();
    /** Client logger. */
    readonly log: Logger;
    /** The bot user, available after the first READY. */
    user: APIUser | null = null;
    /** The application ID, available after the first READY. */
    applicationId: string | null = null;

    readonly #options: ClientOptions;
    readonly #intents: number;

    /** Creates a client. Call {@link Client.connect} to go online. */
    constructor(options: ClientOptions) {
        super();
        this.#options = options;
        this.#intents = Array.isArray(options.intents)
            ? options.intents.reduce((acc, bit) => acc | bit, 0)
            : options.intents;
        this.log = new Logger(options.logger, "client");
        this.logger = this.log;
        this.rest = new RestClient({
            ...options.rest,
            token: options.token,
            apiVersion: options.apiVersion,
            logger: this.log.child("rest"),
        });
        this.api = new API(this.rest);
        this.cache = options.cache ? new Cache(options.cache === true ? {} : options.cache, this.api) : null;
    }

    /**
     * Connects all shards.
     * @returns Resolves once every shard is ready. Rejects if a shard fails fatally.
     */
    async connect(): Promise<void> {
        const info = await this.rest.get<RESTGetAPIGatewayBotResult>(Routes.gatewayBot());
        const total = this.#options.shards === "auto" || this.#options.shards === undefined
            ? info.shards
            : this.#options.shards;
        const { remaining, reset_after, max_concurrency } = info.session_start_limit;
        this.log.info(`Connecting ${total} shard(s); ${remaining} session starts remaining`);
        if (remaining < total) {
            this.log.warn(`Session start limit low, waiting ${reset_after}ms`);
            await new Promise((r) => setTimeout(r, reset_after));
        }

        const identifyGate = createIdentifyGate(max_concurrency);
        const ready: Promise<void>[] = [];
        for (let id = 0; id < total; id++) {
            const shard = new Shard({
                token: this.#options.token,
                intents: this.#intents,
                url: info.url,
                shard: [id, total],
                apiVersion: this.#options.apiVersion,
                compress: this.#options.compress,
                presence: this.#options.presence,
                largeThreshold: this.#options.largeThreshold,
                identifyGate,
                logger: this.log.child(`shard ${id}`),
                onDispatch: (payload, shardId) => this.#onDispatch(payload, shardId),
                onFatal: (error, shardId) => this.emit("error", error, shardId),
            });
            this.shards.set(id, shard);
            ready.push(shard.connect());
        }
        await Promise.all(ready);
    }

    /** Closes all shards. */
    close(): void {
        for (const shard of this.shards.values()) shard.close();
        this.shards.clear();
    }

    /** Updates the presence on all shards. */
    setPresence(presence: GatewayPresenceUpdateData): void {
        this.#options.presence = presence;
        for (const shard of this.shards.values()) shard.updatePresence(presence);
    }

    /** Average heartbeat latency across ready shards in ms, or -1 if unknown. */
    get latency(): number {
        const values = [...this.shards.values()].map((s) => s.latency).filter((l) => l >= 0);
        return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : -1;
    }

    #onDispatch(payload: GatewayDispatchPayload, shardId: number): void {
        this.cache?.handle(payload);
        this.emit("raw", payload, shardId);

        if (payload.t === GatewayDispatchEvents.Ready) {
            const d = payload.d as GatewayReadyDispatchData;
            this.user = d.user;
            this.applicationId = d.application.id;
        }
        if (payload.t === GatewayDispatchEvents.Ready || payload.t === GatewayDispatchEvents.Resumed) {
            this.emit("shardReady", shardId);
        }

        if (payload.t === GatewayDispatchEvents.InteractionCreate) {
            this.emit("INTERACTION_CREATE", new Interaction(payload.d, this.rest), shardId);
            return;
        }
        // deno-lint-ignore no-explicit-any
        (this.emit as any)(payload.t, payload.d, shardId);
    }
}

/**
 * Discord allows `max_concurrency` identifies per 5 seconds, bucketed by `shard_id % max_concurrency`.
 * Returns a gate that serializes identifies per bucket with a 5s gap. Waits only when a bucket was used
 * less than 5s ago, so a single-shard bot never starts a timer.
 */
function createIdentifyGate(maxConcurrency: number): (shardId: number) => Promise<void> {
    const queues = new Map<number, Promise<void>>();
    const lastIdentify = new Map<number, number>();
    return (shardId) => {
        const key = shardId % maxConcurrency;
        const turn = (queues.get(key) ?? Promise.resolve()).then(async () => {
            const wait = (lastIdentify.get(key) ?? 0) + 5_000 - Date.now();
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            lastIdentify.set(key, Date.now());
        });
        queues.set(key, turn);
        return turn;
    };
}
