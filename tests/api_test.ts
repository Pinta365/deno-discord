import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { API, RestClient } from "../mod.ts";
import { encodeEmoji } from "../src/api/shared.ts";

interface RecordedCall {
    method: string;
    path: string;
    url: URL;
    body: BodyInit | null | undefined;
    headers: Headers;
}

type Handler = (call: RecordedCall, n: number) => Response | Promise<Response>;

function recordingFetch(handler: Handler): { fetch: typeof fetch; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const href = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
        const url = new URL(href);
        const call: RecordedCall = {
            method: init?.method ?? "GET",
            path: url.pathname,
            url,
            body: init?.body,
            headers: new Headers(init?.headers),
        };
        calls.push(call);
        return Promise.resolve(handler(call, calls.length));
    };
    return { fetch: fake as typeof fetch, calls };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeAPI(handler: Handler): { api: API; calls: RecordedCall[] } {
    const { fetch, calls } = recordingFetch(handler);
    return { api: new API(new RestClient({ token: "t", fetch })), calls };
}

const CHANNEL = "123456789012345678";
const MESSAGE = "987654321098765432";
const GUILD = "111111111111111111";
const USER = "222222222222222222";
const ROLE = "333333333333333333";

Deno.test("encodeEmoji encodes unicode, name:id and mentions", () => {
    assertEquals(encodeEmoji("👍"), encodeURIComponent("👍"));
    assertEquals(encodeEmoji("party:123456789012345678"), encodeURIComponent("party:123456789012345678"));
    assertEquals(encodeEmoji("<:party:123456789012345678>"), encodeURIComponent("party:123456789012345678"));
    assertEquals(encodeEmoji("<a:party:123456789012345678>"), encodeURIComponent("party:123456789012345678"));
});

Deno.test("channels API builds method, path, body, query and audit log reason", async () => {
    const { api, calls } = makeAPI(() => json({ id: MESSAGE }));

    await api.channels.createMessage(CHANNEL, "hi");
    await api.channels.getMessage(CHANNEL, MESSAGE);
    await api.channels.getMessages(CHANNEL, { limit: 5 });
    await api.channels.deleteMessage(CHANNEL, MESSAGE, { reason: "cleanup" });
    await api.channels.addReaction(CHANNEL, MESSAGE, "👍");
    await api.channels.addReaction(CHANNEL, MESSAGE, "<:party:123456789012345678>");

    assertEquals(calls[0].method, "POST");
    assertEquals(calls[0].path, `/api/v10/channels/${CHANNEL}/messages`);
    assertEquals(calls[0].body, JSON.stringify({ content: "hi" }));

    assertEquals(calls[1].method, "GET");
    assertEquals(calls[1].path, `/api/v10/channels/${CHANNEL}/messages/${MESSAGE}`);

    assertEquals(calls[2].url.searchParams.get("limit"), "5");

    assertEquals(calls[3].method, "DELETE");
    assertEquals(calls[3].headers.get("X-Audit-Log-Reason"), encodeURIComponent("cleanup"));

    assertEquals(calls[4].method, "PUT");
    assertEquals(calls[4].path, `/api/v10/channels/${CHANNEL}/messages/${MESSAGE}/reactions/%F0%9F%91%8D/@me`);
    assertEquals(
        calls[5].path,
        `/api/v10/channels/${CHANNEL}/messages/${MESSAGE}/reactions/${
            encodeURIComponent("party:123456789012345678")
        }/@me`,
    );
});

Deno.test("channel message files produce multipart with attachments filled in", async () => {
    const { api, calls } = makeAPI(() => json({ id: MESSAGE }));

    await api.channels.createMessage(CHANNEL, { content: "log", files: [{ name: "a.txt", data: "hello" }] });

    const body = calls[0].body;
    assertInstanceOf(body, FormData);
    const form = body as FormData;
    assertEquals(
        form.get("payload_json"),
        JSON.stringify({ content: "log", attachments: [{ id: 0, filename: "a.txt" }] }),
    );
    const file = form.get("files[0]");
    assertInstanceOf(file, File);
    assertEquals((file as File).name, "a.txt");
});

Deno.test("guilds API builds method, path, body and query", async () => {
    const { api, calls } = makeAPI(() => json({ id: ROLE }));

    await api.guilds.get(GUILD, { with_counts: true });
    await api.guilds.ban(GUILD, USER, { delete_message_seconds: 60 }, { reason: "spam" });
    await api.guilds.createRole(GUILD, { name: "mod" }, { reason: "setup" });
    await api.guilds.getBans(GUILD, { limit: 10 });
    await api.guilds.addMemberRole(GUILD, USER, ROLE);
    await api.guilds.leave(GUILD);

    assertEquals(calls[0].method, "GET");
    assertEquals(calls[0].path, `/api/v10/guilds/${GUILD}`);
    assertEquals(calls[0].url.searchParams.get("with_counts"), "true");

    assertEquals(calls[1].method, "PUT");
    assertEquals(calls[1].path, `/api/v10/guilds/${GUILD}/bans/${USER}`);
    assertEquals(calls[1].body, JSON.stringify({ delete_message_seconds: 60 }));
    assertEquals(calls[1].headers.get("X-Audit-Log-Reason"), encodeURIComponent("spam"));

    assertEquals(calls[2].method, "POST");
    assertEquals(calls[2].path, `/api/v10/guilds/${GUILD}/roles`);
    assertEquals(calls[2].body, JSON.stringify({ name: "mod" }));

    assertEquals(calls[3].url.searchParams.get("limit"), "10");

    assertEquals(calls[4].method, "PUT");
    assertEquals(calls[4].path, `/api/v10/guilds/${GUILD}/members/${USER}/roles/${ROLE}`);

    assertEquals(calls[5].method, "DELETE");
    assertEquals(calls[5].path, `/api/v10/users/@me/guilds/${GUILD}`);
});

Deno.test("users API builds requests and sendDM makes two calls", async () => {
    const DM_CHANNEL = "555555555555555555";
    const { api, calls } = makeAPI((call) =>
        call.path.endsWith("/users/@me/channels") ? json({ id: DM_CHANNEL }) : json({ id: MESSAGE })
    );

    await api.users.getCurrent();
    await api.users.get(USER);
    await api.users.editCurrent({ username: "newname" });
    await api.users.getCurrentGuilds({ limit: 5 });
    await api.users.sendDM(USER, "yo");

    assertEquals(calls[0].method, "GET");
    assertEquals(calls[0].path, "/api/v10/users/%40me");

    assertEquals(calls[1].path, `/api/v10/users/${USER}`);

    assertEquals(calls[2].method, "PATCH");
    assertEquals(calls[2].path, "/api/v10/users/%40me");
    assertEquals(calls[2].body, JSON.stringify({ username: "newname" }));

    assertEquals(calls[3].path, "/api/v10/users/@me/guilds");
    assertEquals(calls[3].url.searchParams.get("limit"), "5");

    assertEquals(calls.length, 6);
    assertEquals(calls[4].method, "POST");
    assertEquals(calls[4].path, "/api/v10/users/@me/channels");
    assertEquals(calls[4].body, JSON.stringify({ recipient_id: USER }));

    assertEquals(calls[5].method, "POST");
    assertEquals(calls[5].path, `/api/v10/channels/${DM_CHANNEL}/messages`);
    assertEquals(calls[5].body, JSON.stringify({ content: "yo" }));
});

Deno.test("applications API builds method, path and body", async () => {
    const APP = "444444444444444444";
    const COMMAND = "333333333333333333";
    const { api, calls } = makeAPI(() => json({ id: COMMAND }));

    await api.applications.getCurrent();
    await api.applications.getGlobalCommands(APP);
    await api.applications.createGlobalCommand(APP, { name: "ping", description: "pong" });
    await api.applications.bulkOverwriteGlobalCommands(APP, [{ name: "ping", description: "pong" }]);
    await api.applications.getGuildCommandPermissions(APP, GUILD);
    await api.applications.getEntitlements(APP, { sku_ids: "1,2" });
    await api.applications.getSKUs(APP);

    assertEquals(calls[0].method, "GET");
    assertEquals(calls[0].path, "/api/v10/applications/@me");

    assertEquals(calls[1].path, `/api/v10/applications/${APP}/commands`);

    assertEquals(calls[2].method, "POST");
    assertEquals(calls[2].path, `/api/v10/applications/${APP}/commands`);
    assertEquals(calls[2].body, JSON.stringify({ name: "ping", description: "pong" }));

    assertEquals(calls[3].method, "PUT");
    assertEquals(calls[3].body, JSON.stringify([{ name: "ping", description: "pong" }]));

    assertEquals(calls[4].path, `/api/v10/applications/${APP}/guilds/${GUILD}/commands/permissions`);

    assertEquals(calls[5].path, `/api/v10/applications/${APP}/entitlements`);
    assertEquals(calls[5].url.searchParams.get("sku_ids"), "1,2");

    assertEquals(calls[6].path, `/api/v10/applications/${APP}/skus`);
});

Deno.test("webhooks API builds method, path, body, query and auth", async () => {
    const WEBHOOK = "666666666666666666";
    const TOKEN = "tok-".repeat(10);
    const { api, calls } = makeAPI(() => json({ id: MESSAGE }));

    await api.webhooks.get(WEBHOOK);
    await api.webhooks.getWithToken(WEBHOOK, TOKEN);
    await api.webhooks.execute(WEBHOOK, TOKEN, "hello", { wait: true, thread_id: GUILD });
    await api.webhooks.getMessage(WEBHOOK, TOKEN, MESSAGE, { thread_id: GUILD });
    await api.webhooks.editMessage(WEBHOOK, TOKEN, MESSAGE, { content: "edited" });
    await api.webhooks.deleteMessage(WEBHOOK, TOKEN, MESSAGE, { reason: "cleanup" });

    assertEquals(calls[0].method, "GET");
    assertEquals(calls[0].path, `/api/v10/webhooks/${WEBHOOK}`);
    assert(calls[0].headers.get("Authorization") !== null);

    assertEquals(calls[1].path, `/api/v10/webhooks/${WEBHOOK}/${TOKEN}`);
    assertEquals(calls[1].headers.get("Authorization"), null);

    assertEquals(calls[2].method, "POST");
    assertEquals(calls[2].path, `/api/v10/webhooks/${WEBHOOK}/${TOKEN}`);
    assertEquals(calls[2].body, JSON.stringify({ content: "hello" }));
    assertEquals(calls[2].url.searchParams.get("wait"), "true");
    assertEquals(calls[2].url.searchParams.get("thread_id"), GUILD);

    assertEquals(calls[3].method, "GET");
    assertEquals(calls[3].path, `/api/v10/webhooks/${WEBHOOK}/${TOKEN}/messages/${MESSAGE}`);
    assertEquals(calls[3].url.searchParams.get("thread_id"), GUILD);

    assertEquals(calls[4].method, "PATCH");
    assertEquals(calls[4].body, JSON.stringify({ content: "edited" }));

    assertEquals(calls[5].method, "DELETE");
    assertEquals(calls[5].headers.get("X-Audit-Log-Reason"), encodeURIComponent("cleanup"));
});
