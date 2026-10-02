import { assertEquals, assertStringIncludes } from "@std/assert";
import { ApplicationCommandType, InteractionResponseType, InteractionType } from "discord-api-types/v10";
import { createInteractionHandler, Logger, LogLevel } from "../mod.ts";

const silent = new Logger({ level: LogLevel.NONE });
const noopFetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;

function toHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function generateKeys(): Promise<{ privateKey: CryptoKey; publicKeyHex: string }> {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    return { privateKey: pair.privateKey, publicKeyHex: toHex(new Uint8Array(raw)) };
}

async function sign(privateKey: CryptoKey, timestamp: string, body: string): Promise<string> {
    const signature = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(timestamp + body));
    return toHex(new Uint8Array(signature));
}

async function signedRequest(
    body: unknown,
    privateKey: CryptoKey,
    overrides: { timestamp?: string; signature?: string } = {},
): Promise<Request> {
    const text = JSON.stringify(body);
    const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
    const signature = overrides.signature ?? await sign(privateKey, timestamp, text);
    return new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Signature-Ed25519": signature,
            "X-Signature-Timestamp": timestamp,
        },
        body: text,
    });
}

function chatInputBody(): Record<string, unknown> {
    return {
        id: "111111111111111111",
        application_id: "222222222222222222",
        type: InteractionType.ApplicationCommand,
        token: "interaction-token",
        version: 1,
        data: { id: "333333333333333333", name: "ping", type: ApplicationCommandType.ChatInput },
    };
}

Deno.test("a valid PING request is answered with a PONG", async () => {
    const { privateKey, publicKeyHex } = await generateKeys();
    const handler = createInteractionHandler({
        publicKey: publicKeyHex,
        onInteraction: () => {},
        rest: { fetch: noopFetch },
        autoDeferAfter: 0,
        logger: silent,
    });

    const response = await handler(await signedRequest({ type: InteractionType.Ping }, privateKey));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { type: InteractionResponseType.Pong });
});

Deno.test("an invalid signature is rejected with 401", async () => {
    const { privateKey, publicKeyHex } = await generateKeys();
    const handler = createInteractionHandler({
        publicKey: publicKeyHex,
        onInteraction: () => {},
        rest: { fetch: noopFetch },
        autoDeferAfter: 0,
        logger: silent,
    });

    const request = await signedRequest({ type: InteractionType.Ping }, privateKey, {
        signature: "0".repeat(128),
    });

    const response = await handler(request);

    assertEquals(response.status, 401);
    assertStringIncludes(await response.text(), "Invalid request signature");
});

Deno.test("a non-POST request is rejected with 405", async () => {
    const { publicKeyHex } = await generateKeys();
    const handler = createInteractionHandler({
        publicKey: publicKeyHex,
        onInteraction: () => {},
        rest: { fetch: noopFetch },
        autoDeferAfter: 0,
        logger: silent,
    });

    const response = await handler(new Request("https://example.com/interactions", { method: "GET" }));

    assertEquals(response.status, 405);
});

Deno.test("a handler reply is returned as a type 4 JSON response", async () => {
    const { privateKey, publicKeyHex } = await generateKeys();
    const handler = createInteractionHandler({
        publicKey: publicKeyHex,
        onInteraction: async (interaction) => {
            await interaction.reply("Pong!");
        },
        rest: { fetch: noopFetch },
        autoDeferAfter: 0,
        logger: silent,
    });

    const response = await handler(await signedRequest(chatInputBody(), privateKey));
    const json = await response.json() as { type: number; data: { content: string } };

    assertEquals(response.status, 200);
    assertEquals(json.type, InteractionResponseType.ChannelMessageWithSource);
    assertEquals(json.data, { content: "Pong!" });
});

Deno.test("autoDeferAfter defers when the handler never responds", async () => {
    const { privateKey, publicKeyHex } = await generateKeys();
    const handler = createInteractionHandler({
        publicKey: publicKeyHex,
        onInteraction: () => new Promise(() => {}),
        rest: { fetch: noopFetch },
        autoDeferAfter: 20,
        logger: silent,
    });

    const response = await handler(await signedRequest(chatInputBody(), privateKey));
    const json = await response.json() as { type: number };

    assertEquals(response.status, 200);
    assertEquals(json.type, InteractionResponseType.DeferredChannelMessageWithSource);
});

Deno.test("a throwing handler yields a 500 No response", async () => {
    const { privateKey, publicKeyHex } = await generateKeys();
    const handler = createInteractionHandler({
        publicKey: publicKeyHex,
        onInteraction: () => {
            throw new Error("nope");
        },
        rest: { fetch: noopFetch },
        autoDeferAfter: 0,
        logger: silent,
    });

    const response = await handler(await signedRequest(chatInputBody(), privateKey));

    assertEquals(response.status, 500);
    assertEquals(await response.text(), "No response");
});
