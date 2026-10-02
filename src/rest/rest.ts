import { Logger } from "../logger.ts";
import { VERSION } from "../version.ts";
import { DiscordAPIError } from "./errors.ts";

/** A file to upload with a request. */
export interface RawFile {
    /** File name shown in Discord. */
    name: string;
    /** File contents. */
    data: Blob | Uint8Array | string;
    /** MIME type. Inferred by Discord if omitted. */
    contentType?: string;
    /** Form field name. Defaults to `files[<index>]`. */
    key?: string;
}

/** Per-request options. */
export interface RequestOptions {
    /** JSON body. Sent as `payload_json` when files are attached. */
    body?: unknown;
    /** Query string parameters. `undefined` values are skipped. */
    query?: Record<string, string | number | boolean | undefined>;
    /** Files to upload (switches the request to multipart/form-data). */
    files?: RawFile[];
    /** Audit log reason (`X-Audit-Log-Reason`). */
    reason?: string;
    /** Whether to send the bot token. Defaults to `true`. Interaction/webhook-token routes don't need it. */
    auth?: boolean;
    /** Extra headers. */
    headers?: Record<string, string>;
    /** Abort signal for this request. */
    signal?: AbortSignal;
}

/** Options for {@link RestClient}. */
export interface RestOptions {
    /** Bot token (without the `Bot ` prefix). Optional for apps that only answer HTTP interactions. */
    token?: string;
    /** API version. Defaults to 10. */
    apiVersion?: number;
    /** API base URL. Defaults to `https://discord.com/api`. */
    baseUrl?: string;
    /** Retries for network errors and 5xx responses. Defaults to 3. */
    retries?: number;
    /** Per-attempt timeout in milliseconds. Defaults to 15000. */
    timeout?: number;
    /** Appended to the User-Agent header. */
    userAgentSuffix?: string;
    /** Logger to use. */
    logger?: Logger;
    /** Custom fetch implementation (useful for tests). */
    fetch?: typeof fetch;
}

/** HTTP methods used by the Discord API. */
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Bucket {
    remaining: number;
    resetAt: number;
    queue: Promise<void>;
    pending: number;
    lastUsed: number;
}

/** Consecutive 429s tolerated for one request before giving up. */
const MAX_RATE_LIMIT_RETRIES = 5;

/** Idle buckets older than this are dropped. */
const BUCKET_TTL = 5 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Low-level Discord REST client with per-route rate limiting, global 429 handling,
 * retries, timeouts and multipart file uploads.
 */
export class RestClient {
    /** API version in use. */
    readonly apiVersion: number;
    #token: string | undefined;
    readonly #baseUrl: string;
    readonly #retries: number;
    readonly #timeout: number;
    readonly #userAgent: string;
    readonly #logger: Logger;
    readonly #fetch: typeof fetch;
    /** route key -> Discord bucket hash */
    readonly #hashes = new Map<string, string>();
    /** bucket key -> bucket state */
    readonly #buckets = new Map<string, Bucket>();
    #globalResetAt = 0;
    #lastSweep = Date.now();

    /** Creates a REST client. */
    constructor(options: RestOptions = {}) {
        this.#token = options.token;
        this.apiVersion = options.apiVersion ?? 10;
        this.#baseUrl = `${options.baseUrl ?? "https://discord.com/api"}/v${this.apiVersion}`;
        this.#retries = options.retries ?? 3;
        this.#timeout = options.timeout ?? 15_000;
        this.#userAgent = `DiscordBot (https://github.com/Pinta365/deno-discord, ${VERSION})${
            options.userAgentSuffix ? " " + options.userAgentSuffix : ""
        }`;
        this.#logger = options.logger ?? new Logger({}, "rest");
        this.#fetch = options.fetch ?? fetch;
    }

    /** Sets or replaces the bot token. */
    setToken(token: string): void {
        this.#token = token;
    }

    /** Sends a GET request. */
    get<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request("GET", path, options);
    }
    /** Sends a POST request. */
    post<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request("POST", path, options);
    }
    /** Sends a PUT request. */
    put<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request("PUT", path, options);
    }
    /** Sends a PATCH request. */
    patch<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request("PATCH", path, options);
    }
    /** Sends a DELETE request. */
    delete<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request("DELETE", path, options);
    }

    /**
     * Sends a request, waiting for rate limits and retrying where appropriate.
     * @param method HTTP method.
     * @param path Path relative to the versioned API base, e.g. `/channels/123/messages`.
     * @param options Body, files, query, reason, etc.
     * @returns The parsed JSON response, or `undefined` for empty (204) responses.
     */
    async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
        const routeKey = RestClient.routeKey(method, path);
        const major = RestClient.majorParameter(path);
        const bucketKey = () => `${this.#hashes.get(routeKey) ?? routeKey}:${major}`;

        this.#sweep();
        // Serialize requests per bucket so `remaining` stays accurate.
        const bucket = this.#bucket(bucketKey());
        bucket.pending++;
        let release!: () => void;
        const previous = bucket.queue;
        bucket.queue = new Promise((r) => (release = r));
        await previous;

        try {
            let attempt = 0;
            let rateLimitHits = 0;
            while (true) {
                await this.#waitForLimits(this.#bucket(bucketKey()));

                let response: Response;
                try {
                    response = await this.#send(method, path, options);
                } catch (error) {
                    if (options.signal?.aborted || attempt >= this.#retries) throw error;
                    attempt++;
                    this.#logger.warn(`${method} ${path} failed (${error}), retry ${attempt}/${this.#retries}`);
                    await sleep(500 * 2 ** attempt);
                    continue;
                }

                this.#updateBucket(routeKey, major, response.headers);

                if (response.status === 429) {
                    const body = await response.json().catch(() => ({}));
                    const retryAfter = Number(body.retry_after ?? response.headers.get("Retry-After") ?? 1) * 1000;
                    if (body.global || response.headers.get("X-RateLimit-Global")) {
                        this.#globalResetAt = Date.now() + retryAfter;
                    }
                    if (++rateLimitHits > MAX_RATE_LIMIT_RETRIES) {
                        throw new DiscordAPIError(429, method, path, body);
                    }
                    this.#logger.warn(`Rate limited on ${method} ${path}, retrying in ${retryAfter}ms`);
                    await sleep(retryAfter);
                    continue;
                }

                if (response.status >= 500 && attempt < this.#retries) {
                    await response.body?.cancel();
                    attempt++;
                    this.#logger.warn(`${method} ${path} returned ${response.status}, retry ${attempt}`);
                    await sleep(500 * 2 ** attempt);
                    continue;
                }

                const body = await RestClient.#parse(response);
                if (!response.ok) throw new DiscordAPIError(response.status, method, path, body);
                return body as T;
            }
        } finally {
            bucket.pending--;
            bucket.lastUsed = Date.now();
            release();
        }
    }

    async #send(method: Method, path: string, options: RequestOptions): Promise<Response> {
        const url = new URL(this.#baseUrl + path);
        for (const [k, v] of Object.entries(options.query ?? {})) {
            if (v !== undefined) url.searchParams.set(k, String(v));
        }

        const headers = new Headers({ "User-Agent": this.#userAgent, ...options.headers });
        if (options.auth !== false && this.#token) headers.set("Authorization", `Bot ${this.#token}`);
        if (options.reason) headers.set("X-Audit-Log-Reason", encodeURIComponent(options.reason));

        let body: BodyInit | undefined;
        if (options.files?.length) {
            const form = new FormData();
            options.files.forEach((file, i) => {
                const blob = file.data instanceof Blob
                    ? file.data
                    : new Blob([file.data as BlobPart], file.contentType ? { type: file.contentType } : {});
                form.append(file.key ?? `files[${i}]`, blob, file.name);
            });
            if (options.body !== undefined) form.append("payload_json", JSON.stringify(options.body));
            body = form;
        } else if (options.body !== undefined) {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(options.body);
        }

        const timeout = AbortSignal.timeout(this.#timeout);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        this.#logger.debug(method, url.pathname);
        return await this.#fetch(url, { method, headers, body, signal });
    }

    #bucket(key: string): Bucket {
        let bucket = this.#buckets.get(key);
        if (!bucket) {
            bucket = { remaining: 1, resetAt: 0, queue: Promise.resolve(), pending: 0, lastUsed: Date.now() };
            this.#buckets.set(key, bucket);
        }
        return bucket;
    }

    #sweep(): void {
        const now = Date.now();
        if (now - this.#lastSweep < BUCKET_TTL) return;
        this.#lastSweep = now;
        for (const [key, bucket] of this.#buckets) {
            if (bucket.pending === 0 && now - bucket.lastUsed > BUCKET_TTL && bucket.resetAt < now) {
                this.#buckets.delete(key);
            }
        }
    }

    async #waitForLimits(bucket: Bucket): Promise<void> {
        const globalWait = this.#globalResetAt - Date.now();
        if (globalWait > 0) await sleep(globalWait);
        if (bucket.remaining <= 0) {
            const wait = bucket.resetAt - Date.now();
            if (wait > 0) {
                this.#logger.debug(`Bucket exhausted, waiting ${wait}ms`);
                await sleep(wait);
            }
        }
    }

    #updateBucket(routeKey: string, major: string, headers: Headers): void {
        const hash = headers.get("X-RateLimit-Bucket");
        if (!hash) return;
        if (this.#hashes.get(routeKey) !== hash) {
            // First time we learn the hash: carry the queue over to the shared bucket.
            const old = this.#buckets.get(`${this.#hashes.get(routeKey) ?? routeKey}:${major}`);
            this.#hashes.set(routeKey, hash);
            const key = `${hash}:${major}`;
            if (old && !this.#buckets.has(key)) this.#buckets.set(key, old);
        }
        const bucket = this.#bucket(`${hash}:${major}`);
        const remaining = headers.get("X-RateLimit-Remaining");
        const resetAfter = headers.get("X-RateLimit-Reset-After");
        if (remaining !== null) bucket.remaining = Number(remaining);
        if (resetAfter !== null) bucket.resetAt = Date.now() + Number(resetAfter) * 1000;
    }

    static async #parse(response: Response): Promise<unknown> {
        if (response.status === 204) return undefined;
        const text = await response.text();
        if (!text) return undefined;
        if (response.headers.get("Content-Type")?.includes("application/json")) {
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        }
        return text;
    }

    /**
     * Builds a rate-limit route key: IDs are replaced by placeholders except for major parameters.
     * Message deletes get their own key because Discord limits them separately.
     */
    static routeKey(method: string, path: string): string {
        const clean = path.split("?")[0];
        const key = clean
            .replace(/\/(channels|guilds|webhooks)\/(\d{16,21})/g, "/$1/:major")
            .replace(/\/(webhooks\/:major|interactions\/\d{16,21})\/[\w-]{60,}/g, "/$1/:token")
            .replace(/\/reactions\/[^/]+/g, "/reactions/:reaction")
            .replace(/\d{16,21}/g, ":id");
        return method === "DELETE" && /\/channels\/:major\/messages\/:id$/.test(key)
            ? `DELETE-msg ${key}`
            : `${method} ${key}`;
    }

    /** Extracts the major parameter (channel, guild, webhook ID + token, or interaction ID) from a path. */
    static majorParameter(path: string): string {
        const webhook = /^\/webhooks\/(\d{16,21})\/([\w-]+)/.exec(path);
        if (webhook) return `${webhook[1]}:${webhook[2]}`;
        // Each interaction has its own callback bucket; don't serialize them behind one another.
        const interaction = /^\/interactions\/(\d{16,21})\//.exec(path);
        if (interaction) return `interaction:${interaction[1]}`;
        return /^\/(?:channels|guilds|webhooks)\/(\d{16,21})/.exec(path)?.[1] ?? "global";
    }
}
