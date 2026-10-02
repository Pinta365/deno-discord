import { assert, assertEquals, assertInstanceOf, assertRejects, assertStringIncludes } from "@std/assert";
import { DiscordAPIError, Logger, LogLevel, RestClient } from "../mod.ts";
import { redactPath } from "../src/rest/rest.ts";

type FetchInput = string | URL | Request;

interface RecordedCall {
    url: URL;
    init: RequestInit;
}

type Handler = (url: URL, init: RequestInit, call: number) => Response | Promise<Response>;

function recordingFetch(handler: Handler): { fetch: typeof fetch; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const fake = (input: FetchInput, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const request = init ?? {};
        calls.push({ url, init: request });
        return Promise.resolve(handler(url, request, calls.length));
    };
    return { fetch: fake as typeof fetch, calls };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { ...init, headers, status: init.status ?? 200 });
}

Deno.test("routeKey replaces ids and keeps major parameters", () => {
    assertEquals(RestClient.routeKey("GET", "/channels/123456789012345678/messages"), "GET /channels/:major/messages");
    assertEquals(
        RestClient.routeKey("GET", "/channels/123456789012345678/messages/987654321098765432"),
        "GET /channels/:major/messages/:id",
    );
    assertEquals(
        RestClient.routeKey("DELETE", "/channels/123456789012345678/messages/987654321098765432"),
        "DELETE-msg /channels/:major/messages/:id",
    );
    assertEquals(
        RestClient.routeKey(
            "PUT",
            "/channels/123456789012345678/messages/987654321098765432/reactions/%F0%9F%91%8D/@me",
        ),
        "PUT /channels/:major/messages/:id/reactions/:reaction/@me",
    );
});

Deno.test("routeKey collapses webhook tokens and majorParameter returns id and token", () => {
    const token = "a".repeat(68);
    const path = `/webhooks/123456789012345678/${token}`;
    assertEquals(RestClient.routeKey("POST", path), "POST /webhooks/:major/:token");
    assertEquals(RestClient.majorParameter(path), `123456789012345678:${token}`);
});

Deno.test("majorParameter falls back to global and extracts guild ids", () => {
    assertEquals(RestClient.majorParameter("/channels/123456789012345678/messages"), "123456789012345678");
    assertEquals(RestClient.majorParameter("/guilds/123456789012345678/roles"), "123456789012345678");
    assertEquals(RestClient.majorParameter("/users/@me"), "global");
    assertEquals(RestClient.majorParameter("/gateway/bot"), "global");
});

Deno.test("request sends JSON body, auth header and audit log reason", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    const rest = new RestClient({ token: "test-token", fetch });

    const result = await rest.post<{ ok: boolean }>("/channels/123456789012345678/messages", {
        body: { content: "hi" },
        reason: "because reasons",
    });

    assertEquals(result, { ok: true });
    assertEquals(calls.length, 1);
    const { url, init } = calls[0];
    assertEquals(url.pathname, "/api/v10/channels/123456789012345678/messages");
    assertEquals(init.method, "POST");
    assertEquals(init.body, JSON.stringify({ content: "hi" }));
    const headers = new Headers(init.headers);
    assertEquals(headers.get("Authorization"), "Bot test-token");
    assertEquals(headers.get("Content-Type"), "application/json");
    assertEquals(headers.get("X-Audit-Log-Reason"), encodeURIComponent("because reasons"));
});

Deno.test("auth:false omits the Authorization header", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse({ url: "wss://gateway" }));
    const rest = new RestClient({ token: "test-token", fetch });

    await rest.get("/gateway/bot", { auth: false });

    const headers = new Headers(calls[0].init.headers);
    assertEquals(headers.get("Authorization"), null);
    assertEquals(headers.get("User-Agent")?.startsWith("DiscordBot ("), true);
});

Deno.test("query params are appended and undefined values skipped", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse([]));
    const rest = new RestClient({ token: "t", fetch });

    await rest.get("/channels/123456789012345678/messages", {
        query: { limit: 50, before: "987654321098765432", skip: undefined },
    });

    const { searchParams } = calls[0].url;
    assertEquals(searchParams.get("limit"), "50");
    assertEquals(searchParams.get("before"), "987654321098765432");
    assertEquals(searchParams.has("skip"), false);
});

Deno.test("files switch the request to multipart with a payload_json part", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse({ id: "1" }));
    const rest = new RestClient({ token: "t", fetch });

    await rest.post("/channels/123456789012345678/messages", {
        body: { content: "with file" },
        files: [{ name: "a.txt", data: "hello", contentType: "text/plain" }],
    });

    const body = calls[0].init.body;
    assertInstanceOf(body, FormData);
    const form = body as FormData;
    assertEquals(form.get("payload_json"), JSON.stringify({ content: "with file" }));
    const file = form.get("files[0]");
    assertInstanceOf(file, File);
    assertEquals((file as File).name, "a.txt");
    assertEquals(new Headers(calls[0].init.headers).get("Content-Type"), null);
});

Deno.test("204 responses resolve to undefined", async () => {
    const { fetch } = recordingFetch(() => new Response(null, { status: 204 }));
    const rest = new RestClient({ token: "t", fetch });

    const result = await rest.delete("/channels/123456789012345678/messages/987654321098765432");

    assertEquals(result, undefined);
});

Deno.test("4xx responses throw DiscordAPIError with status and code", async () => {
    const { fetch } = recordingFetch(() =>
        jsonResponse({ code: 50035, message: "Invalid Form Body", errors: { content: { _errors: [] } } }, {
            status: 400,
        })
    );
    const rest = new RestClient({ token: "t", fetch });

    const error = await assertRejects(
        () => rest.post("/channels/123456789012345678/messages", { body: {} }),
        DiscordAPIError,
    );

    assertEquals(error.status, 400);
    assertEquals(error.code, 50035);
    assertEquals(error.method, "POST");
    assertStringIncludes(error.message, "Invalid Form Body");
    assertEquals(error.errors, { content: { _errors: [] } });
});

Deno.test("429 responses are retried after retry_after", async () => {
    const { fetch, calls } = recordingFetch((_url, _init, call) => {
        if (call === 1) {
            return jsonResponse(
                { message: "You are being rate limited.", retry_after: 0.01, global: false },
                { status: 429 },
            );
        }
        return jsonResponse({ ok: true });
    });
    const rest = new RestClient({ token: "t", fetch });

    const result = await rest.get("/channels/123456789012345678/messages");

    assertEquals(result, { ok: true });
    assertEquals(calls.length, 2);
});

Deno.test("5xx responses are retried before succeeding", async () => {
    let call = 0;
    const { fetch, calls } = recordingFetch(() => {
        call++;
        return call === 1 ? new Response("boom", { status: 500 }) : jsonResponse({ ok: true });
    });
    const rest = new RestClient({ token: "t", fetch, retries: 3 });

    const result = await rest.post("/channels/123456789012345678/messages", { body: { content: "x" } });

    assertEquals(result, { ok: true });
    assertEquals(calls.length, 2);
});

Deno.test("persistent 429 responses throw after the retry cap", async () => {
    const { fetch, calls } = recordingFetch(() =>
        jsonResponse({ message: "You are being rate limited.", retry_after: 0, global: false }, { status: 429 })
    );
    const rest = new RestClient({ token: "t", fetch, logger: new Logger({ level: LogLevel.NONE }) });

    const error = await assertRejects(
        () => rest.get("/channels/123456789012345678/messages"),
        DiscordAPIError,
    );

    assertEquals(error.status, 429);
    assertEquals(error.method, "GET");
    assertEquals(calls.length, 6);
});

Deno.test("an exhausted bucket waits for Reset-After before the next request", async () => {
    let call = 0;
    const resetHeaders = { "X-RateLimit-Bucket": "bucket-abc", "X-RateLimit-Reset-After": "0.05" };
    const { fetch } = recordingFetch(() => {
        call++;
        const remaining = call === 1 ? "0" : "1";
        return jsonResponse({ call }, { headers: { ...resetHeaders, "X-RateLimit-Remaining": remaining } });
    });
    const rest = new RestClient({ token: "t", fetch });

    await rest.get("/channels/123456789012345678/messages");
    const start = Date.now();
    await rest.get("/channels/123456789012345678/messages");
    const elapsed = Date.now() - start;

    assert(elapsed >= 40, `expected to wait for the bucket, but only waited ${elapsed}ms`);
});

Deno.test("webhook and interaction tokens never appear in logs or error messages", async () => {
    const token = "aW50ZXJhY3Rpb246c2VjcmV0LXRva2VuLXRoYXQtc2hvdWxkLW5vdC1sZWFrLWludG8tbG9ncw";
    assertEquals(
        redactPath(`/webhooks/123456789012345678/${token}/messages/@original`),
        "/webhooks/123456789012345678/:token/messages/@original",
    );
    assertEquals(
        redactPath(`/interactions/123456789012345678/${token}/callback`),
        "/interactions/123456789012345678/:token/callback",
    );
    assertEquals(redactPath("/channels/123456789012345678/messages"), "/channels/123456789012345678/messages");

    const logs: string[] = [];
    const rest = new RestClient({
        fetch: () => Promise.resolve(Response.json({ message: "Unknown Webhook", code: 10015 }, { status: 404 })),
        logger: new Logger({ level: LogLevel.TRACE, handler: (_l, _s, args) => logs.push(args.map(String).join(" ")) }),
    });
    const error = await assertRejects(
        () => rest.patch(`/webhooks/123456789012345678/${token}/messages/@original`, { body: {}, auth: false }),
        DiscordAPIError,
    );
    assert(!error.message.includes(token), error.message);
    assert(!error.path.includes(token));
    assert(logs.length > 0 && logs.every((line) => !line.includes(token)), logs.join("\n"));
});
