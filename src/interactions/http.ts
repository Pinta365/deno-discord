import {
    type APIInteraction,
    type APIInteractionResponse,
    InteractionResponseType,
    InteractionType,
} from "discord-api-types/v10";
import { Logger } from "../logger.ts";
import { RestClient, type RestOptions } from "../rest/rest.ts";
import { Interaction } from "./interaction.ts";
import type { RawFile } from "../rest/rest.ts";

/** Options for {@link createInteractionHandler}. */
export interface InteractionHandlerOptions {
    /** The application's public key (hex), from the Developer Portal. */
    publicKey: string;
    /** Called for every verified interaction except PING. */
    onInteraction: (interaction: Interaction) => unknown;
    /** REST client (or options for one) used for follow-ups. A token is not required. */
    rest?: RestClient | RestOptions;
    /**
     * Automatically defer if the handler hasn't responded after this many ms, so Discord's 3s deadline
     * isn't missed. A later `reply()` then edits the deferred message. Set to 0 to disable. Defaults to 2500.
     */
    autoDeferAfter?: number;
    /** Logger. */
    logger?: Logger;
}

/**
 * Creates a `Request -> Response` handler for Discord HTTP interactions (the "Interactions Endpoint URL").
 * Works with `Deno.serve`, Deno Deploy, or any framework that speaks the Fetch API.
 *
 * @example
 * ```ts
 * const handler = createInteractionHandler({
 *     publicKey: Deno.env.get("PUBLIC_KEY")!,
 *     onInteraction: async (i) => {
 *         if (i.commandName === "ping") await i.reply("Pong!");
 *     },
 * });
 * Deno.serve(handler);
 * ```
 */
export function createInteractionHandler(options: InteractionHandlerOptions): (req: Request) => Promise<Response> {
    const log = options.logger ?? new Logger({}, "http");
    const rest = options.rest instanceof RestClient ? options.rest : new RestClient({ logger: log, ...options.rest });
    const autoDeferAfter = options.autoDeferAfter ?? 2500;
    const keyPromise = importPublicKey(options.publicKey);

    return async (req: Request): Promise<Response> => {
        if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

        const signature = req.headers.get("X-Signature-Ed25519");
        const timestamp = req.headers.get("X-Signature-Timestamp");
        const body = await req.text();
        if (!signature || !timestamp || !(await verify(await keyPromise, signature, timestamp, body))) {
            return new Response("Invalid request signature", { status: 401 });
        }

        let raw: APIInteraction;
        try {
            raw = JSON.parse(body);
        } catch {
            return new Response("Bad Request", { status: 400 });
        }

        if (raw.type === InteractionType.Ping) return json({ type: InteractionResponseType.Pong });

        let resolveResponse!: (res: Response) => void;
        const initial = new Promise<Response>((r) => (resolveResponse = r));
        const interaction = new Interaction(raw, rest, (response, files) => {
            resolveResponse(toResponse(response, files));
            return Promise.resolve();
        });

        let timer: ReturnType<typeof setTimeout> | undefined;
        if (autoDeferAfter > 0 && raw.type !== InteractionType.ApplicationCommandAutocomplete) {
            timer = setTimeout(() => {
                if (interaction.responded) return;
                log.debug(`Auto-deferring interaction ${raw.id}`);
                const defer = raw.type === InteractionType.MessageComponent
                    ? interaction.deferUpdate()
                    : interaction.deferReply();
                defer.catch((err) => log.error("Auto-defer failed", err));
            }, autoDeferAfter);
        }

        const handled = Promise.resolve()
            .then(() => options.onInteraction(interaction))
            .catch((err) => log.error(`Error handling interaction ${raw.id}`, err))
            .then(() => {
                if (!interaction.responded) {
                    log.warn(`Interaction ${raw.id} finished without a response`);
                    return new Response("No response", { status: 500 });
                }
                return initial;
            });

        try {
            return await Promise.race([initial, handled]);
        } finally {
            clearTimeout(timer);
        }
    };
}

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function toResponse(response: APIInteractionResponse, files?: RawFile[]): Response {
    if (!files?.length) return json(response);
    const form = new FormData();
    form.append("payload_json", JSON.stringify(response));
    files.forEach((file, i) => {
        const blob = file.data instanceof Blob
            ? file.data
            : new Blob([file.data as BlobPart], file.contentType ? { type: file.contentType } : {});
        form.append(file.key ?? `files[${i}]`, blob, file.name);
    });
    return new Response(form);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

async function importPublicKey(hex: string): Promise<CryptoKey> {
    return await crypto.subtle.importKey("raw", hexToBytes(hex), { name: "Ed25519" }, false, ["verify"]);
}

/**
 * Verifies a Discord interaction request signature.
 * @param key Public key imported for Ed25519 verify.
 * @param signature `X-Signature-Ed25519` header (hex).
 * @param timestamp `X-Signature-Timestamp` header.
 * @param body Raw request body.
 */
export async function verify(key: CryptoKey, signature: string, timestamp: string, body: string): Promise<boolean> {
    if (!/^[0-9a-f]{128}$/i.test(signature)) return false;
    try {
        return await crypto.subtle.verify(
            "Ed25519",
            key,
            hexToBytes(signature),
            new TextEncoder().encode(timestamp + body),
        );
    } catch {
        return false;
    }
}
