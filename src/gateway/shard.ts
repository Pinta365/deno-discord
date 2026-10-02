import { createInflate, type Inflate } from "node:zlib";
import { Buffer } from "node:buffer";
import {
    GatewayCloseCodes,
    GatewayDispatchEvents,
    type GatewayDispatchPayload,
    type GatewayIdentifyData,
    GatewayOpcodes,
    type GatewayPresenceUpdateData,
    type GatewayReadyDispatchData,
    type GatewayReceivePayload,
    type GatewaySendPayload,
} from "discord-api-types/v10";
import { Logger } from "../logger.ts";
import { VERSION } from "../version.ts";

/** Lifecycle status of a {@link Shard}. */
export type ShardStatus = "idle" | "connecting" | "identifying" | "resuming" | "ready" | "reconnecting" | "closed";

/** Options for {@link Shard}. */
export interface ShardOptions {
    /** Bot token. */
    token: string;
    /** Intents bitfield. */
    intents: number;
    /** Gateway URL from `GET /gateway/bot`. */
    url: string;
    /** `[shard_id, num_shards]`. Defaults to `[0, 1]`. */
    shard?: [number, number];
    /** API version. Defaults to 10. */
    apiVersion?: number;
    /** Use zlib-stream transport compression. Defaults to `true`. */
    compress?: boolean;
    /** Initial presence. */
    presence?: GatewayPresenceUpdateData;
    /** Member count at which offline members are omitted (50–250). */
    largeThreshold?: number;
    /** Called before every identify; resolve when this shard may identify (max_concurrency). */
    identifyGate?: (shardId: number) => Promise<void>;
    /** Called for every dispatch event. */
    onDispatch: (payload: GatewayDispatchPayload, shardId: number) => void;
    /** Called when the shard fails permanently (e.g. invalid token or intents). */
    onFatal?: (error: Error, shardId: number) => void;
    /** Logger. */
    logger?: Logger;
    /** WebSocket constructor (for tests). */
    WebSocket?: typeof WebSocket;
}

/** Close codes after which reconnecting is pointless. */
const FATAL_CLOSE_CODES = new Set<number>([
    GatewayCloseCodes.AuthenticationFailed,
    GatewayCloseCodes.InvalidShard,
    GatewayCloseCodes.ShardingRequired,
    GatewayCloseCodes.InvalidAPIVersion,
    GatewayCloseCodes.InvalidIntents,
    GatewayCloseCodes.DisallowedIntents,
]);

/** Close codes after which the session can't be resumed and a fresh identify is needed. */
const SESSION_INVALIDATING_CLOSE_CODES = new Set<number>([
    GatewayCloseCodes.InvalidSeq,
    GatewayCloseCodes.SessionTimedOut,
]);

/** Close code we use when we want Discord to keep the session alive for a resume. */
const RESUME_CLOSE_CODE = 4900;

const SEND_LIMIT = 120;
const SEND_WINDOW = 60_000;
/** Slots per window reserved for heartbeats. */
const HEARTBEAT_RESERVE = 5;

const ZLIB_SUFFIX = [0x00, 0x00, 0xff, 0xff];

/** A single gateway connection (one shard). */
export class Shard {
    /** This shard's ID. */
    readonly id: number;
    /** Current status. */
    status: ShardStatus = "idle";
    /** Round-trip time of the last heartbeat in ms, or -1 if unknown. */
    latency: number = -1;

    readonly #opts: ShardOptions;
    readonly #log: Logger;
    readonly #WS: typeof WebSocket;
    #ws: WebSocket | null = null;

    #sessionId: string | null = null;
    #resumeUrl: string | null = null;
    #seq: number | null = null;

    #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    #ackReceived = true;
    #lastHeartbeatSent = 0;

    #sendTimestamps: number[] = [];
    #sendQueue: { payload: GatewaySendPayload; priority: boolean }[] = [];
    #drainTimer: ReturnType<typeof setTimeout> | null = null;

    #inflate: Inflate | null = null;
    #inflateChunks: Buffer[] = [];

    #reconnectAttempts = 0;
    #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** Message of the last socket error on the current connection, included in the close log. */
    #lastSocketError: string | null = null;
    #closing = false;
    #readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

    /** Creates a shard. Call {@link Shard.connect} to open it. */
    constructor(options: ShardOptions) {
        this.#opts = options;
        this.id = options.shard?.[0] ?? 0;
        this.#log = options.logger ?? new Logger({}, `shard ${this.id}`);
        this.#WS = options.WebSocket ?? WebSocket;
    }

    /** Session ID of the current session, if any. */
    get sessionId(): string | null {
        return this.#sessionId;
    }

    /**
     * Opens the connection and identifies.
     * @returns Resolves when READY (or RESUMED) is received; rejects on a fatal close.
     */
    connect(): Promise<void> {
        this.#closing = false;
        const ready = new Promise<void>((resolve, reject) => this.#readyWaiters.push({ resolve, reject }));
        this.#open(false);
        return ready;
    }

    /**
     * Closes the connection for good.
     * @param resumable Keep the session alive so a later process can resume it. Defaults to `false`.
     */
    close(resumable = false): void {
        this.#closing = true;
        this.status = "closed";
        if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
        this.#cleanup();
        this.#ws?.close(resumable ? RESUME_CLOSE_CODE : 1000, "Client closed");
        this.#ws = null;
        if (!resumable) this.#resetSession();
    }

    /** Updates this shard's presence. */
    updatePresence(presence: GatewayPresenceUpdateData): void {
        this.#opts.presence = presence;
        this.send({ op: GatewayOpcodes.PresenceUpdate, d: presence });
    }

    /**
     * Sends a payload, respecting the gateway send limit (120 per 60s).
     * Payloads sent while disconnected are queued until the session is ready.
     */
    send(payload: GatewaySendPayload, priority = false): void {
        const entry = { payload, priority };
        if (priority) this.#sendQueue.unshift(entry);
        else this.#sendQueue.push(entry);
        this.#drain();
    }

    // --- connection lifecycle ---------------------------------------------------------------

    #open(resume: boolean): void {
        const base = resume && this.#resumeUrl ? this.#resumeUrl : this.#opts.url;
        const url = new URL(base);
        url.searchParams.set("v", String(this.#opts.apiVersion ?? 10));
        url.searchParams.set("encoding", "json");
        if (this.#opts.compress ?? true) url.searchParams.set("compress", "zlib-stream");

        this.status = resume ? "resuming" : "connecting";
        this.#log.info(`Connecting to ${url.origin} (${resume ? "resume" : "identify"})`);

        this.#setupInflate();
        const ws = new this.#WS(url.toString());
        ws.binaryType = "arraybuffer";
        ws.onmessage = (e) => this.#onRaw(e.data);
        ws.onclose = (e) => {
            if (this.#ws === ws) this.#onClose(e.code, e.reason);
        };
        ws.onerror = (e) => {
            const message = (e as ErrorEvent).message || String(e.type);
            if (this.#ws === ws) this.#lastSocketError = message;
            this.#log.debug("WebSocket error", message);
        };
        this.#lastSocketError = null;
        this.#ws = ws;
    }

    #onClose(rawCode: number, reason: string): void {
        this.#cleanup();
        this.#ws = null;
        if (this.#closing) return;

        // Deno reports 0 when the TCP connection drops without a close frame; the standard code is 1006.
        const code = rawCode === 0 ? 1006 : rawCode;
        this.#log.warn(`Connection closed: ${describeClose(code, reason, this.#lastSocketError)}`);
        this.#lastSocketError = null;

        if (FATAL_CLOSE_CODES.has(code)) {
            this.status = "closed";
            const error = new Error(`Gateway closed with fatal code ${code} (${GatewayCloseCodes[code]}): ${reason}`);
            this.#rejectReady(error);
            this.#opts.onFatal?.(error, this.id);
            return;
        }
        if (SESSION_INVALIDATING_CLOSE_CODES.has(code)) this.#resetSession();
        this.#reconnect();
    }

    /** Reconnects with exponential backoff, or right away when `immediate` (Discord asked us to). */
    #reconnect(immediate = false): void {
        if (this.#closing) return;
        this.status = "reconnecting";
        if (immediate) {
            this.#log.info("Reconnecting now");
            this.#schedule(0, () => this.#open(this.#canResume()));
            return;
        }
        const delay = Math.min(1000 * 2 ** this.#reconnectAttempts, 60_000) * (0.5 + Math.random() * 0.5);
        this.#reconnectAttempts++;
        this.#log.info(`Reconnecting in ${Math.round(delay)}ms (attempt ${this.#reconnectAttempts})`);
        this.#schedule(delay, () => this.#open(this.#canResume()));
    }

    /** setTimeout that close() can cancel. */
    #schedule(delay: number, fn: () => void): void {
        if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            if (!this.#closing) fn();
        }, delay);
    }

    /** Close the socket ourselves and let the close handler reconnect. */
    #forceReconnect(resume: boolean, immediate = false): void {
        if (!resume) this.#resetSession();
        const ws = this.#ws;
        if (!ws) {
            this.#reconnect(immediate);
            return;
        }
        // Detach first so a slow close doesn't race the new connection.
        this.#ws = null;
        this.#cleanup();
        ws.close(resume ? RESUME_CLOSE_CODE : 1000, "Reconnecting");
        this.#reconnect(immediate);
    }

    #canResume(): boolean {
        return this.#sessionId !== null && this.#seq !== null;
    }

    #resetSession(): void {
        this.#sessionId = null;
        this.#resumeUrl = null;
        this.#seq = null;
    }

    #cleanup(): void {
        if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer);
        if (this.#drainTimer) clearTimeout(this.#drainTimer);
        this.#heartbeatTimer = null;
        this.#drainTimer = null;
        this.#inflate?.close();
        this.#inflate = null;
        if (this.status !== "closed") this.status = "reconnecting";
    }

    #resolveReady(): void {
        this.#reconnectAttempts = 0;
        for (const w of this.#readyWaiters.splice(0)) w.resolve();
    }

    #rejectReady(error: Error): void {
        for (const w of this.#readyWaiters.splice(0)) w.reject(error);
    }

    // --- decoding ------------------------------------------------------------------------------

    #setupInflate(): void {
        this.#inflate?.close();
        this.#inflate = null;
        this.#inflateChunks = [];
        if (!(this.#opts.compress ?? true)) return;
        const inflate = createInflate({ chunkSize: 128 * 1024 });
        inflate.on("data", (chunk: Buffer) => this.#inflateChunks.push(chunk));
        inflate.on("error", (err: Error) => {
            this.#log.error("Decompression error, reconnecting", err);
            this.#forceReconnect(true);
        });
        this.#inflate = inflate;
    }

    #onRaw(data: string | ArrayBuffer): void {
        if (typeof data === "string") return this.#onPayload(data);

        const bytes = new Uint8Array(data);
        const inflate = this.#inflate;
        if (!inflate) return this.#onPayload(new TextDecoder().decode(bytes));

        inflate.write(bytes);
        const n = bytes.length;
        const complete = n >= 4 && ZLIB_SUFFIX.every((b, i) => bytes[n - 4 + i] === b);
        if (!complete) return;
        inflate.flush(() => {
            if (this.#inflate !== inflate) return;
            const text = Buffer.concat(this.#inflateChunks).toString("utf8");
            this.#inflateChunks = [];
            if (text) this.#onPayload(text);
        });
    }

    #onPayload(text: string): void {
        let payload: GatewayReceivePayload;
        try {
            payload = JSON.parse(text);
        } catch (err) {
            this.#log.error("Failed to parse gateway payload", err);
            return;
        }
        this.#log.trace("<-", payload.op, payload.t ?? "");

        switch (payload.op) {
            case GatewayOpcodes.Hello:
                this.#startHeartbeat(payload.d.heartbeat_interval);
                if (this.status === "resuming" && this.#canResume()) this.#resume();
                else this.#identify();
                break;
            case GatewayOpcodes.HeartbeatAck:
                this.#ackReceived = true;
                this.latency = Date.now() - this.#lastHeartbeatSent;
                break;
            case GatewayOpcodes.Heartbeat:
                this.#heartbeat();
                break;
            case GatewayOpcodes.Reconnect:
                this.#log.info("Discord requested reconnect");
                this.#forceReconnect(true, true);
                break;
            case GatewayOpcodes.InvalidSession:
                this.#log.warn(`Invalid session (resumable: ${payload.d})`);
                if (payload.d) {
                    this.#forceReconnect(true);
                } else {
                    this.#resetSession();
                    // Discord asks for a 1–5s wait before re-identifying.
                    this.#schedule(1000 + Math.random() * 4000, () => this.#identify());
                }
                break;
            case GatewayOpcodes.Dispatch:
                this.#onDispatch(payload);
                break;
        }
    }

    #onDispatch(payload: GatewayDispatchPayload): void {
        this.#seq = payload.s;
        if (payload.t === GatewayDispatchEvents.Ready) {
            const d = payload.d as GatewayReadyDispatchData;
            this.#sessionId = d.session_id;
            this.#resumeUrl = d.resume_gateway_url;
            this.status = "ready";
            this.#log.info(`Ready as ${d.user.username} (session ${d.session_id})`);
            this.#resolveReady();
            this.#drain();
        } else if (payload.t === GatewayDispatchEvents.Resumed) {
            this.status = "ready";
            this.#log.info("Resumed session");
            this.#resolveReady();
            this.#drain();
        }
        try {
            this.#opts.onDispatch(payload, this.id);
        } catch (err) {
            this.#log.error(`Error in ${payload.t} handler`, err);
        }
    }

    // --- outgoing ------------------------------------------------------------------------------

    async #identify(): Promise<void> {
        if (this.#closing) return;
        this.status = "identifying";
        await this.#opts.identifyGate?.(this.id);
        if (this.#closing || !this.#ws) return;
        const d: GatewayIdentifyData = {
            token: this.#opts.token,
            intents: this.#opts.intents,
            properties: {
                os: Deno.build.os,
                browser: `@pinta365/discord ${VERSION}`,
                device: "@pinta365/discord",
            },
            shard: this.#opts.shard ?? [0, 1],
        };
        if (this.#opts.presence) d.presence = this.#opts.presence;
        if (this.#opts.largeThreshold) d.large_threshold = this.#opts.largeThreshold;
        this.#rawSend({ op: GatewayOpcodes.Identify, d });
    }

    #resume(): void {
        this.#rawSend({
            op: GatewayOpcodes.Resume,
            d: { token: this.#opts.token, session_id: this.#sessionId!, seq: this.#seq! },
        });
    }

    #startHeartbeat(interval: number): void {
        if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer);
        this.#ackReceived = true;
        const beat = () => {
            if (!this.#ackReceived) {
                this.#log.warn("Heartbeat not acknowledged, connection is zombied; resuming");
                this.#forceReconnect(true);
                return;
            }
            this.#heartbeat();
            this.#heartbeatTimer = setTimeout(beat, interval);
        };
        // First heartbeat after interval * jitter, as the docs require.
        this.#heartbeatTimer = setTimeout(beat, interval * Math.random());
    }

    #heartbeat(): void {
        this.#ackReceived = false;
        this.#lastHeartbeatSent = Date.now();
        this.#rawSend({ op: GatewayOpcodes.Heartbeat, d: this.#seq }, true);
    }

    /** Sends immediately if possible (used for heartbeat/identify/resume); counts toward the limit. */
    #rawSend(payload: GatewaySendPayload, isHeartbeat = false): void {
        if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
        this.#pruneSendWindow();
        if (!isHeartbeat && this.#sendTimestamps.length >= SEND_LIMIT) {
            this.#log.warn("Gateway send limit hit for a control payload; this should not happen");
        }
        this.#sendTimestamps.push(Date.now());
        this.#log.trace("->", payload.op);
        this.#ws.send(JSON.stringify(payload));
    }

    #pruneSendWindow(): void {
        const cutoff = Date.now() - SEND_WINDOW;
        while (this.#sendTimestamps.length && this.#sendTimestamps[0] <= cutoff) this.#sendTimestamps.shift();
    }

    #drain(): void {
        if (this.#drainTimer || this.status !== "ready") return;
        while (this.#sendQueue.length) {
            this.#pruneSendWindow();
            if (this.#sendTimestamps.length >= SEND_LIMIT - HEARTBEAT_RESERVE) {
                const wait = this.#sendTimestamps[0] + SEND_WINDOW - Date.now();
                this.#drainTimer = setTimeout(() => {
                    this.#drainTimer = null;
                    this.#drain();
                }, wait);
                return;
            }
            this.#rawSend(this.#sendQueue.shift()!.payload);
        }
    }
}

const STANDARD_CLOSE_CODES: Record<number, string> = {
    1000: "normal closure",
    1001: "going away",
    1006: "abnormal closure, no close frame",
    1011: "server error",
    1012: "service restart",
    1014: "bad gateway",
};

/**
 * Formats a close for logging, e.g. `1006 abnormal closure, no close frame (Unexpected EOF)`
 * or `4004 AuthenticationFailed: Authentication failed.`
 */
export function describeClose(code: number, reason: string, error?: string | null): string {
    const name = GatewayCloseCodes[code] ?? STANDARD_CLOSE_CODES[code] ?? "unknown close code";
    let text = `${code} ${name}`;
    if (reason) text += `: ${reason}`;
    if (error) text += ` (${error})`;
    return text;
}
