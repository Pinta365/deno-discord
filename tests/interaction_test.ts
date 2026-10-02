import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import {
    type APIInteraction,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ComponentType,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
} from "discord-api-types/v10";
import { type InitialResponder, Interaction, type RawFile, RestClient } from "../mod.ts";

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

function commandInteraction(overrides: Record<string, unknown> = {}): APIInteraction {
    return {
        id: "111111111111111111",
        application_id: APP_ID,
        type: InteractionType.ApplicationCommand,
        token: TOKEN,
        version: 1,
        data: { id: "333333333333333333", name: "ping", type: ApplicationCommandType.ChatInput },
        ...overrides,
    } as unknown as APIInteraction;
}

Deno.test("reply with a string sends a CHANNEL_MESSAGE_WITH_SOURCE response", async () => {
    const { responses, respond } = capture();
    const interaction = new Interaction(commandInteraction(), rest, respond);

    await interaction.reply("hello");

    assertEquals(responses.length, 1);
    assertEquals(responses[0], {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: "hello" },
    });
    assertEquals(interaction.responded, true);
});

Deno.test("ephemeral replies set the EPHEMERAL message flag", async () => {
    const { responses, respond } = capture();
    const interaction = new Interaction(commandInteraction(), rest, respond);

    await interaction.reply({ content: "secret", ephemeral: true });

    const flags = Number(responses[0].data?.flags ?? 0);
    assertEquals(flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
    assertEquals(responses[0].data?.content, "secret");
});

Deno.test("replying twice throws", async () => {
    const { respond } = capture();
    const interaction = new Interaction(commandInteraction(), rest, respond);

    await interaction.reply("one");

    await assertRejects(() => interaction.reply("two"), Error, "already been responded to");
});

Deno.test("deferReply followed by reply PATCHes the original response", async () => {
    const calls: { method: string; path: string }[] = [];
    const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        calls.push({ method: init?.method ?? "GET", path: url.pathname });
        if (init?.method === "PATCH") {
            return Promise.resolve(
                new Response(JSON.stringify({ id: "m1" }), { headers: { "Content-Type": "application/json" } }),
            );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    const restWithFetch = new RestClient({ token: "t", fetch: fakeFetch });

    const interaction = new Interaction(commandInteraction(), restWithFetch);
    await interaction.deferReply();
    await interaction.reply("done");

    assertEquals(calls.length, 2);
    assertEquals(calls[0].method, "POST");
    assert(calls[0].path.endsWith("/callback"));
    assertEquals(calls[1].method, "PATCH");
    assertEquals(calls[1].path, `/api/v10/webhooks/${APP_ID}/${TOKEN}/messages/@original`);
});

Deno.test("subcommand group and getOption resolve through nested options", () => {
    const interaction = new Interaction(
        commandInteraction({
            data: {
                id: "c",
                name: "cmd",
                type: ApplicationCommandType.ChatInput,
                options: [
                    {
                        name: "grp",
                        type: ApplicationCommandOptionType.SubcommandGroup,
                        options: [
                            {
                                name: "sub",
                                type: ApplicationCommandOptionType.Subcommand,
                                options: [
                                    { name: "text", type: ApplicationCommandOptionType.String, value: "hello" },
                                    { name: "count", type: ApplicationCommandOptionType.Integer, value: 7 },
                                ],
                            },
                        ],
                    },
                ],
            },
        }),
        rest,
    );

    assertEquals(interaction.commandName, "cmd");
    assertEquals(interaction.subcommandGroup, "grp");
    assertEquals(interaction.subcommand, "sub");
    assertEquals(interaction.options.map((option) => option.name), ["text", "count"]);
    assertEquals(interaction.getOption("text"), "hello");
    assertEquals(interaction.getOption<number>("count"), 7);
    assertEquals(interaction.getOption("missing"), undefined);
});

Deno.test("focusedOption reports the autocomplete target", () => {
    const interaction = new Interaction(
        commandInteraction({
            type: InteractionType.ApplicationCommandAutocomplete,
            data: {
                id: "c",
                name: "search",
                type: ApplicationCommandType.ChatInput,
                options: [
                    { name: "q", type: ApplicationCommandOptionType.String, value: "ab", focused: true },
                    { name: "other", type: ApplicationCommandOptionType.String, value: "x" },
                ],
            },
        }),
        rest,
    );

    assert(interaction.isAutocomplete());
    assertEquals(interaction.commandName, "search");
    assertEquals(interaction.focusedOption, { name: "q", value: "ab" });
});

Deno.test("modalValues collects values including nested label components", () => {
    const interaction = new Interaction(
        commandInteraction({
            type: InteractionType.ModalSubmit,
            data: {
                custom_id: "modal-1",
                components: [
                    { type: 1, components: [{ type: 4, custom_id: "name", value: "Ada" }] },
                    { type: 18, component: { type: 4, custom_id: "age", value: "36" } },
                ],
            },
        }),
        rest,
    );

    assert(interaction.isModalSubmit());
    assertEquals(interaction.customId, "modal-1");
    assertEquals(interaction.modalValues, { name: "Ada", age: "36" });
});

Deno.test("modalValues types inputs nested in Label components", () => {
    const interaction = new Interaction(
        commandInteraction({
            type: InteractionType.ModalSubmit,
            data: {
                custom_id: "modal-types",
                components: [
                    {
                        type: ComponentType.Label,
                        component: { type: ComponentType.TextInput, custom_id: "text", value: "hello" },
                    },
                    {
                        type: ComponentType.Label,
                        component: { type: ComponentType.RadioGroup, custom_id: "radio", value: "a" },
                    },
                    {
                        type: ComponentType.Label,
                        component: { type: ComponentType.RadioGroup, custom_id: "radioEmpty", value: null },
                    },
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            { type: ComponentType.StringSelect, custom_id: "select", values: ["x", "y"] },
                        ],
                    },
                    {
                        type: ComponentType.Label,
                        component: { type: ComponentType.CheckboxGroup, custom_id: "checks", values: ["a", "b"] },
                    },
                    {
                        type: ComponentType.Label,
                        component: { type: ComponentType.FileUpload, custom_id: "upload", values: ["file-1"] },
                    },
                    {
                        type: ComponentType.Label,
                        component: { type: ComponentType.Checkbox, custom_id: "check", value: true },
                    },
                ],
            },
        }),
        rest,
    );

    assertEquals(interaction.modalValues, {
        text: "hello",
        radio: "a",
        radioEmpty: null,
        select: ["x", "y"],
        checks: ["a", "b"],
        upload: ["file-1"],
        check: true,
    });
    assertEquals(interaction.getModalText("text"), "hello");
    assertEquals(interaction.getModalText("radio"), "a");
    assertEquals(interaction.getModalText("radioEmpty"), undefined);
    assertEquals(interaction.getModalText("select"), undefined);
});

Deno.test("component interactions expose customId and type helpers", () => {
    const interaction = new Interaction(
        commandInteraction({
            type: InteractionType.MessageComponent,
            data: { custom_id: "btn-1", component_type: 2 },
        }),
        rest,
    );

    assert(interaction.isMessageComponent());
    assert(interaction.isButton());
    assertFalse(interaction.isSelectMenu());
    assertEquals(interaction.customId, "btn-1");
    assertEquals(interaction.commandName, undefined);
});

Deno.test("files are normalized into attachments when replying", async () => {
    const { responses, respond } = capture();
    const interaction = new Interaction(commandInteraction(), rest, respond);
    const files: RawFile[] = [{ name: "a.txt", data: "hi" }];

    await interaction.reply({ content: "with file", files });

    const attachments = responses[0].data?.attachments as { id: number; filename: string }[];
    assertEquals(attachments, [{ id: 0, filename: "a.txt" }]);
});
