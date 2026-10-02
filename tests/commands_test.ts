import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import {
    type APIApplicationCommandOption,
    type APIInteraction,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ComponentType,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
    type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import {
    API,
    CommandRouter,
    type InitialResponder,
    Interaction,
    messageCommand,
    option,
    RestClient,
    slash,
    subcommand,
    userCommand,
} from "../mod.ts";
import { optionsToJSON } from "../src/commands/options.ts";

const APP_ID = "222222222222222222";
const TOKEN = "tok-".repeat(10);

const noopFetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;
const rest = new RestClient({ token: "t", fetch: noopFetch });

interface Captured {
    type: number;
    data?: Record<string, unknown>;
}

function capture(): { responses: Captured[]; respond: InitialResponder } {
    const responses: Captured[] = [];
    const respond: InitialResponder = (response) => {
        responses.push(response as unknown as Captured);
        return Promise.resolve();
    };
    return { responses, respond };
}

interface RecordedCall {
    method: string;
    path: string;
    body: BodyInit | null | undefined;
}

function recordingFetch(handler?: (call: RecordedCall) => Response): { fetch: typeof fetch; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const href = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
        const url = new URL(href);
        const call: RecordedCall = { method: init?.method ?? "GET", path: url.pathname, body: init?.body };
        calls.push(call);
        return Promise.resolve(handler ? handler(call) : new Response(null, { status: 204 }));
    };
    return { fetch: fake as typeof fetch, calls };
}

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function commandRaw(name: string, data: Record<string, unknown> = {}): APIInteraction {
    return {
        id: "111111111111111111",
        application_id: APP_ID,
        type: InteractionType.ApplicationCommand,
        token: TOKEN,
        version: 1,
        data: { id: "333333333333333333", name, type: ApplicationCommandType.ChatInput, ...data },
    } as unknown as APIInteraction;
}

function componentRaw(
    customId: string,
    type: InteractionType.MessageComponent | InteractionType.ModalSubmit = InteractionType.MessageComponent,
): APIInteraction {
    return {
        id: "111111111111111111",
        application_id: APP_ID,
        type,
        token: TOKEN,
        version: 1,
        data: { custom_id: customId, component_type: ComponentType.Button, components: [] },
    } as unknown as APIInteraction;
}

function autocompleteRaw(name: string, options: unknown[]): APIInteraction {
    return {
        id: "111111111111111111",
        application_id: APP_ID,
        type: InteractionType.ApplicationCommandAutocomplete,
        token: TOKEN,
        version: 1,
        data: { id: "333333333333333333", name, type: ApplicationCommandType.ChatInput, options },
    } as unknown as APIInteraction;
}

const USER_ID: string = "400000000000000001";
const USER2_ID: string = "400000000000000002";
const ROLE_ID: string = "400000000000000003";
const CHANNEL_ID: string = "400000000000000004";
const ATTACH_ID: string = "400000000000000005";

const users: Record<string, unknown> = {
    [USER_ID]: { id: USER_ID, username: "ada", discriminator: "0" },
    [USER2_ID]: { id: USER2_ID, username: "bob", discriminator: "0" },
};
const members: Record<string, unknown> = {
    [USER_ID]: { roles: [ROLE_ID], joined_at: "2020-01-01T00:00:00.000Z" },
};
const roles: Record<string, unknown> = {
    [ROLE_ID]: {
        id: ROLE_ID,
        name: "Admin",
        color: 0,
        position: 1,
        permissions: "0",
        managed: false,
        mentionable: true,
        hoist: false,
    },
};
const channels: Record<string, unknown> = { [CHANNEL_ID]: { id: CHANNEL_ID, name: "general", type: 0 } };
const attachments: Record<string, unknown> = {
    [ATTACH_ID]: {
        id: ATTACH_ID,
        filename: "a.txt",
        size: 3,
        url: "https://example.com/a.txt",
        proxy_url: "https://example.com/a.txt",
    },
};
const resolved = { users, members, roles, channels, attachments };

// --- option builders -------------------------------------------------------------------------

Deno.test("option.string omits required unless true and maps choices", () => {
    const optional = option.string("desc");
    assertFalse("required" in optional.json);
    assertEquals(optional.required, false);

    const required = option.string("desc", { required: true });
    assertEquals(required.json.required, true);
    assertEquals(required.required, true);

    const choices = option.string("desc", { choices: ["a", { name: "B", value: "b" }] });
    assertEquals((choices.json as Record<string, unknown>).choices, [{ name: "a", value: "a" }, {
        name: "B",
        value: "b",
    }]);
});

Deno.test("option.integer maps number choices and keeps min/max", () => {
    const def = option.integer("desc", { choices: [1, { name: "Two", value: 2 }], min_value: 0, max_value: 10 });
    const json = def.json as Record<string, unknown>;
    assertEquals(json.choices, [{ name: "1", value: 1 }, { name: "Two", value: 2 }]);
    assertEquals(json.min_value, 0);
    assertEquals(json.max_value, 10);
});

Deno.test("autocomplete setting adds autocomplete: true and keeps the handler", () => {
    const handler = () => ["x"];
    const def = option.string("desc", { autocomplete: handler });
    assertEquals((def.json as Record<string, unknown>).autocomplete, true);
    assertEquals(def.autocomplete, handler);

    const plain = option.number("desc");
    assertFalse("autocomplete" in plain.json);
    assertEquals(plain.autocomplete, undefined);
});

Deno.test("channel_types pass through for channel options", () => {
    const chan = option.channel("desc", { channel_types: [0, 2] });
    assertEquals((chan.json as Record<string, unknown>).channel_types, [0, 2]);
});

Deno.test("optionsToJSON takes names from keys in order", () => {
    const json = optionsToJSON({
        first: option.string("A", { required: true }),
        second: option.integer("B"),
    });
    assertEquals(json.map((o) => o.name), ["first", "second"]);
    assertEquals(json[0], {
        name: "first",
        type: ApplicationCommandOptionType.String,
        description: "A",
        required: true,
    });
    assertEquals(optionsToJSON(undefined), []);
});

// --- slash commands --------------------------------------------------------------------------

Deno.test("slash toJSON has ChatInput type and options in order", () => {
    const cmd = slash({
        name: "opts",
        description: "d",
        options: { a: option.string("A", { required: true }), b: option.integer("B") },
    }, () => {});
    const json = cmd.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody;
    assertEquals(cmd.type, ApplicationCommandType.ChatInput);
    assertEquals(json.type, ApplicationCommandType.ChatInput);
    assertEquals(json.name, "opts");
    assertEquals(json.options?.map((o) => o.name), ["a", "b"]);
});

Deno.test("slash handler receives resolved option values", async () => {
    let got: Record<string, unknown> | undefined;
    const cmd = slash({
        name: "opts",
        description: "d",
        options: {
            text: option.string("Text", { required: true }),
            count: option.integer("Count"),
            ratio: option.number("Ratio"),
            flag: option.boolean("Flag"),
            plain: option.user("Plain"),
            withMember: option.user("With member"),
            role: option.role("Role"),
            chan: option.channel("Channel"),
            file: option.attachment("File"),
            mentionUser: option.mentionable("Mention user"),
            mentionRole: option.mentionable("Mention role"),
            missing: option.string("Missing"),
        },
    }, (_interaction, options) => {
        got = options as Record<string, unknown>;
    });

    await cmd.run(
        new Interaction(
            commandRaw("opts", {
                options: [
                    { name: "text", type: ApplicationCommandOptionType.String, value: "hello" },
                    { name: "count", type: ApplicationCommandOptionType.Integer, value: 7 },
                    { name: "ratio", type: ApplicationCommandOptionType.Number, value: 1.5 },
                    { name: "flag", type: ApplicationCommandOptionType.Boolean, value: false },
                    { name: "plain", type: ApplicationCommandOptionType.User, value: USER2_ID },
                    { name: "withMember", type: ApplicationCommandOptionType.User, value: USER_ID },
                    { name: "role", type: ApplicationCommandOptionType.Role, value: ROLE_ID },
                    { name: "chan", type: ApplicationCommandOptionType.Channel, value: CHANNEL_ID },
                    { name: "file", type: ApplicationCommandOptionType.Attachment, value: ATTACH_ID },
                    { name: "mentionUser", type: ApplicationCommandOptionType.Mentionable, value: USER_ID },
                    { name: "mentionRole", type: ApplicationCommandOptionType.Mentionable, value: ROLE_ID },
                ],
                resolved,
            }),
            rest,
        ),
    );

    assertEquals(got?.text, "hello");
    assertEquals(got?.count, 7);
    assertEquals(got?.ratio, 1.5);
    assertEquals(got?.flag, false);
    assertEquals(got?.plain, { user: users[USER2_ID] });
    assertEquals(got?.withMember, { user: users[USER_ID], member: members[USER_ID] });
    assertEquals(got?.role, roles[ROLE_ID]);
    assertEquals(got?.chan, channels[CHANNEL_ID]);
    assertEquals(got?.file, attachments[ATTACH_ID]);
    assertEquals(got?.mentionUser, { user: users[USER_ID], member: members[USER_ID] });
    assertEquals(got?.mentionRole, roles[ROLE_ID]);
    assertEquals(got?.missing, undefined);
});

Deno.test("slash subcommands and groups produce nested JSON", () => {
    const cmd = slash({
        name: "cfg",
        description: "d",
        subcommands: {
            plain: subcommand({ description: "No options" }, () => {}),
        },
        groups: {
            group: {
                description: "A group",
                subcommands: {
                    gs: subcommand({
                        description: "In group",
                        options: { n: option.integer("N", { required: true }) },
                    }, () => {}),
                },
            },
        },
    });
    const opts = (cmd.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody).options ?? [];

    const group = opts.find((o) => o.name === "group") as APIApplicationCommandOption & {
        options: (APIApplicationCommandOption & { options?: APIApplicationCommandOption[] })[];
    };
    assertEquals(group.type, ApplicationCommandOptionType.SubcommandGroup);
    assertEquals(group.options.map((o) => o.name), ["gs"]);
    assertEquals(group.options[0].type, ApplicationCommandOptionType.Subcommand);
    assertEquals(group.options[0].options?.map((o) => o.name), ["n"]);

    const plain = opts.find((o) => o.name === "plain");
    assert(plain);
    assertEquals(plain.type, ApplicationCommandOptionType.Subcommand);
    assertFalse("options" in plain);
});

Deno.test("slash dispatches to subcommand and group subcommand leaves", async () => {
    const calls: string[] = [];
    const cmd = slash({
        name: "cfg",
        description: "d",
        subcommands: {
            sub: subcommand({ description: "s" }, (_i, options) => {
                calls.push(`sub:${JSON.stringify(options)}`);
            }),
        },
        groups: {
            grp: {
                description: "g",
                subcommands: {
                    inner: subcommand({ description: "i", options: { n: option.integer("N") } }, (_i, options) => {
                        calls.push(`inner:${JSON.stringify(options)}`);
                    }),
                },
            },
        },
    });

    await cmd.run(
        new Interaction(
            commandRaw("cfg", {
                options: [{ name: "sub", type: ApplicationCommandOptionType.Subcommand }],
            }),
            rest,
        ),
    );

    await cmd.run(
        new Interaction(
            commandRaw("cfg", {
                options: [{
                    name: "grp",
                    type: ApplicationCommandOptionType.SubcommandGroup,
                    options: [{
                        name: "inner",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [{ name: "n", type: ApplicationCommandOptionType.Integer, value: 5 }],
                    }],
                }],
            }),
            rest,
        ),
    );

    assertEquals(calls, ["sub:{}", 'inner:{"n":5}']);
});

Deno.test("slash without a handler or subcommands throws", () => {
    assertThrows(
        () => slash({ name: "x", description: "d" }),
        Error,
        "needs a handler or subcommands",
    );
});

// --- autocomplete ----------------------------------------------------------------------------

Deno.test("autocomplete routes the focused option to its handler", async () => {
    let received: string | number | undefined;
    const cmd = slash({
        name: "search",
        description: "d",
        options: {
            q: option.string("Q", {
                autocomplete: (_interaction, value) => {
                    received = value;
                    return ["apple", "apricot"];
                },
            }),
        },
    }, () => {});

    const { responses, respond } = capture();
    await cmd.autocomplete(
        new Interaction(
            autocompleteRaw("search", [
                { name: "q", type: ApplicationCommandOptionType.String, value: "ap", focused: true },
                { name: "other", type: ApplicationCommandOptionType.String, value: "x" },
            ]),
            rest,
            respond,
        ),
    );

    assertEquals(received, "ap");
    assertEquals(responses[0].type, InteractionResponseType.ApplicationCommandAutocompleteResult);
    assertEquals(responses[0].data?.choices, [{ name: "apple", value: "apple" }, {
        name: "apricot",
        value: "apricot",
    }]);
});

Deno.test("autocomplete maps primitives and {name,value} choices", async () => {
    const cmd = slash({
        name: "n",
        description: "d",
        options: {
            q: option.integer("Q", { autocomplete: () => [1, { name: "Two", value: 2 }] }),
        },
    }, () => {});

    const { responses, respond } = capture();
    await cmd.autocomplete(
        new Interaction(
            autocompleteRaw("n", [
                { name: "q", type: ApplicationCommandOptionType.Integer, value: 1, focused: true },
            ]),
            rest,
            respond,
        ),
    );

    assertEquals(responses[0].data?.choices, [{ name: "1", value: 1 }, { name: "Two", value: 2 }]);
});

Deno.test("autocomplete caps choices at 25", async () => {
    const cmd = slash({
        name: "many",
        description: "d",
        options: {
            q: option.string("Q", { autocomplete: () => Array.from({ length: 30 }, (_, i) => `c${i}`) }),
        },
    }, () => {});

    const { responses, respond } = capture();
    await cmd.autocomplete(
        new Interaction(
            autocompleteRaw("many", [
                { name: "q", type: ApplicationCommandOptionType.String, value: "c", focused: true },
            ]),
            rest,
            respond,
        ),
    );

    assertEquals((responses[0].data?.choices as unknown[]).length, 25);
});

Deno.test("autocomplete responds with no choices when there is no handler", async () => {
    const cmd = slash({
        name: "plain",
        description: "d",
        options: { q: option.string("Q") },
    }, () => {});

    const { responses, respond } = capture();
    await cmd.autocomplete(
        new Interaction(
            autocompleteRaw("plain", [
                { name: "q", type: ApplicationCommandOptionType.String, value: "a", focused: true },
            ]),
            rest,
            respond,
        ),
    );

    assertEquals(responses[0].data?.choices, []);
});

Deno.test("autocomplete responds with no choices for an unknown focused option", async () => {
    const cmd = slash({
        name: "plain2",
        description: "d",
        options: { q: option.string("Q") },
    }, () => {});

    const { responses, respond } = capture();
    await cmd.autocomplete(
        new Interaction(
            autocompleteRaw("plain2", [
                { name: "unknown", type: ApplicationCommandOptionType.String, value: "a", focused: true },
            ]),
            rest,
            respond,
        ),
    );

    assertEquals(responses[0].data?.choices, []);
});

// --- context menu commands -------------------------------------------------------------------

Deno.test("userCommand resolves the target user and member from resolved data", async () => {
    let target: unknown;
    const cmd = userCommand({ name: "Whois" }, (_interaction, resolvedTarget) => {
        target = resolvedTarget;
    });
    assertEquals(cmd.toJSON().type, ApplicationCommandType.User);

    await cmd.run(
        new Interaction(
            commandRaw("Whois", {
                type: ApplicationCommandType.User,
                target_id: USER_ID,
                resolved,
            }),
            rest,
        ),
    );

    assertEquals(target, { user: users[USER_ID], member: members[USER_ID] });
});

Deno.test("userCommand omits the member when absent", async () => {
    let target: unknown;
    const cmd = userCommand({ name: "Whois" }, (_interaction, resolvedTarget) => {
        target = resolvedTarget;
    });

    await cmd.run(
        new Interaction(
            commandRaw("Whois", {
                type: ApplicationCommandType.User,
                target_id: USER2_ID,
                resolved,
            }),
            rest,
        ),
    );

    assertEquals(target, { user: users[USER2_ID] });
});

Deno.test("messageCommand resolves the target message", async () => {
    const message = { id: "m1", content: "hi", channel_id: CHANNEL_ID, author: users[USER_ID] };
    let target: unknown;
    const cmd = messageCommand({ name: "Bookmark" }, (_interaction, resolvedTarget) => {
        target = resolvedTarget;
    });
    assertEquals(cmd.toJSON().type, ApplicationCommandType.Message);

    await cmd.run(
        new Interaction(
            commandRaw("Bookmark", {
                type: ApplicationCommandType.Message,
                target_id: "m1",
                resolved: { messages: { m1: message } },
            }),
            rest,
        ),
    );

    assertEquals(target, message);
});

// --- CommandRouter ---------------------------------------------------------------------------

Deno.test("CommandRouter dispatches by command type and name", async () => {
    const runs: string[] = [];
    const slashCmd = slash({ name: "foo", description: "d" }, () => {
        runs.push("slash");
    });
    const userCmd = userCommand({ name: "foo" }, () => {
        runs.push("user");
    });
    const router = new CommandRouter([slashCmd, userCmd]);

    const outcomes = [
        await router.handle(new Interaction(commandRaw("foo"), rest)),
        await router.handle(
            new Interaction(
                commandRaw("foo", {
                    type: ApplicationCommandType.User,
                    target_id: USER_ID,
                    resolved,
                }),
                rest,
            ),
        ),
    ];

    assertEquals(outcomes, [true, true]);
    assertEquals(runs, ["slash", "user"]);
});

Deno.test("CommandRouter rejects duplicate commands", () => {
    const cmd = slash({ name: "dup", description: "d" }, () => {});
    assertThrows(() => new CommandRouter([cmd, cmd]), Error, 'Duplicate command "dup"');
});

Deno.test("CommandRouter returns false for unknown commands", async () => {
    const router = new CommandRouter();
    assertEquals(await router.handle(new Interaction(commandRaw("nope"), rest)), false);
});

Deno.test("CommandRouter routes components by exact id and prefix args", async () => {
    const seen: string[] = [];
    const router = new CommandRouter().component("vote", (_interaction, args) => {
        seen.push(`vote:${args.join(",")}`);
    });

    await router.handle(new Interaction(componentRaw("vote"), rest));
    await router.handle(new Interaction(componentRaw("vote:a:b"), rest));

    assertEquals(seen, ["vote:", "vote:a,b"]);
});

Deno.test("CommandRouter prefers the longest component prefix", async () => {
    const seen: string[] = [];
    const router = new CommandRouter()
        .component("vote", (_interaction, args) => {
            seen.push(`base:${args.join(",")}`);
        })
        .component("vote:admin", (_interaction, args) => {
            seen.push(`admin:${args.join(",")}`);
        });

    await router.handle(new Interaction(componentRaw("vote:admin:delete"), rest));

    assertEquals(seen, ["admin:delete"]);
});

Deno.test("CommandRouter routes modals separately from components", async () => {
    const seen: string[] = [];
    const router = new CommandRouter()
        .component("m", () => {
            seen.push("component");
        })
        .modal("m", () => {
            seen.push("modal");
        });

    await router.handle(new Interaction(componentRaw("m"), rest));
    await router.handle(new Interaction(componentRaw("m", InteractionType.ModalSubmit), rest));

    assertEquals(seen, ["component", "modal"]);
});

Deno.test("CommandRouter reports handler errors and replies ephemerally", async () => {
    const errors: unknown[] = [];
    const { responses, respond } = capture();
    const router = new CommandRouter(
        [slash({ name: "boom", description: "d" }, () => {
            throw new Error("kaboom");
        })],
        { onError: (error) => void errors.push(error) },
    );

    const handled = await router.handle(new Interaction(commandRaw("boom"), rest, respond));

    assertEquals(handled, true);
    assertEquals(errors.length, 1);
    assertEquals((errors[0] as Error).message, "kaboom");
    assertEquals(responses.length, 1);
    assertEquals(responses[0].type, InteractionResponseType.ChannelMessageWithSource);
    assertEquals(responses[0].data?.content, "Something went wrong.");
    assertEquals(Number(responses[0].data?.flags) & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
});

Deno.test("CommandRouter edits the reply when a deferred handler throws", async () => {
    const { responses, respond } = capture();
    const { fetch, calls } = recordingFetch(() => json({ id: "m1" }));
    const restWithFetch = new RestClient({ token: "t", fetch });
    const router = new CommandRouter(
        [slash({ name: "slow", description: "d" }, async (interaction) => {
            await interaction.deferReply();
            throw new Error("late");
        })],
        { onError: () => {} },
    );

    await router.handle(new Interaction(commandRaw("slow"), restWithFetch, respond));

    assertEquals(responses.length, 1);
    assertEquals(responses[0].type, InteractionResponseType.DeferredChannelMessageWithSource);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].method, "PATCH");
    assertEquals(calls[0].path, `/api/v10/webhooks/${APP_ID}/${TOKEN}/messages/@original`);
});

Deno.test("CommandRouter sends nothing when errorMessage is false", async () => {
    const { responses, respond } = capture();
    const router = new CommandRouter(
        [slash({ name: "boom2", description: "d" }, () => {
            throw new Error("x");
        })],
        { errorMessage: false, onError: () => {} },
    );

    await router.handle(new Interaction(commandRaw("boom2"), rest, respond));

    assertEquals(responses.length, 0);
});

Deno.test("CommandRouter does not reply when an autocomplete handler throws", async () => {
    const { responses, respond } = capture();
    const router = new CommandRouter(
        [slash({
            name: "ac",
            description: "d",
            options: {
                q: option.string("Q", {
                    autocomplete: () => {
                        throw new Error("nope");
                    },
                }),
            },
        }, () => {})],
        { onError: () => {} },
    );

    await router.handle(
        new Interaction(
            autocompleteRaw("ac", [
                { name: "q", type: ApplicationCommandOptionType.String, value: "a", focused: true },
            ]),
            rest,
            respond,
        ),
    );

    assertEquals(responses.length, 0);
});

Deno.test("CommandRouter.register bulk overwrites global and guild commands", async () => {
    const { fetch, calls } = recordingFetch(() => json([]));
    const api = new API(new RestClient({ token: "t", fetch }));
    const cmd = slash({ name: "ping", description: "Pong" }, () => {});
    const router = new CommandRouter([cmd]);

    await router.register(api, APP_ID);
    await router.register(api, APP_ID, { guildId: "999999999999999999" });

    assertEquals(calls.length, 2);
    assertEquals(calls[0].method, "PUT");
    assertEquals(calls[0].path, `/api/v10/applications/${APP_ID}/commands`);
    assertEquals(calls[1].method, "PUT");
    assertEquals(calls[1].path, `/api/v10/applications/${APP_ID}/guilds/999999999999999999/commands`);
    assertEquals(calls[0].body, JSON.stringify([cmd.toJSON()]));
});

Deno.test("subcommand with an empty options object registers no options key", () => {
    const cmd = slash({
        name: "a",
        description: "d",
        subcommands: { s: subcommand({ description: "x", options: {} }, () => {}) },
    });
    const json = cmd.toJSON() as unknown as { options: Record<string, unknown>[] };
    assertEquals("options" in json.options[0], false);
});

Deno.test("slash() with both a handler and subcommands throws instead of dropping them", () => {
    assertThrows(
        () =>
            // deno-lint-ignore no-explicit-any
            (slash as any)({
                name: "b",
                description: "d",
                subcommands: { s: subcommand({ description: "x" }, () => {}) },
            }, () => {}),
        Error,
        "can't have both",
    );
});
