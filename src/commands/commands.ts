import {
    type APIApplicationCommandOption,
    type APIApplicationCommandOptionChoice,
    type APIInteractionDataResolved,
    type APIMessage,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    type RESTPostAPIApplicationCommandsJSONBody,
    type RESTPostAPIChatInputApplicationCommandsJSONBody,
    type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { Interaction } from "../interactions/interaction.ts";
import { type InferOptions, type OptionsRecord, optionsToJSON, type ResolvedUser, resolveOptions } from "./options.ts";

/** A slash command (or subcommand) handler. */
export type CommandHandler<O extends OptionsRecord | undefined> = (
    interaction: Interaction,
    options: InferOptions<O>,
) => unknown;

/** Command-level settings shared by all command kinds (permissions, contexts, localizations, ...). */
export type CommandSettings = Omit<
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    "type" | "options" | "name" | "description"
>;

/** A subcommand: description, typed options and a handler. Create with {@link subcommand}. */
export interface Subcommand {
    /** The subcommand's JSON, without `name` (filled in from the key). */
    readonly json: Omit<APIApplicationCommandOption, "name">;
    /** Options of this subcommand. */
    readonly options: OptionsRecord | undefined;
    /** Handler. */
    readonly handler: CommandHandler<OptionsRecord | undefined>;
}

/** A subcommand group: a description and its subcommands. */
export interface SubcommandGroup {
    /** Group description. */
    description: string;
    /** Subcommands in the group, keyed by name. */
    subcommands: Record<string, Subcommand>;
}

/** A command that a {@link CommandRouter} can register and dispatch. */
export interface Command {
    /** Command name. */
    readonly name: string;
    /** Command type (chat input, user or message). */
    readonly type: ApplicationCommandType;
    /** The JSON body to register with Discord. */
    toJSON(): RESTPostAPIApplicationCommandsJSONBody;
    /** Runs the command for an interaction. Used by the router. */
    run(interaction: Interaction): Promise<void>;
    /** Answers an autocomplete request. Used by the router. */
    autocomplete(interaction: Interaction): Promise<void>;
}

interface Leaf {
    options: OptionsRecord | undefined;
    handler: CommandHandler<OptionsRecord | undefined>;
}

/**
 * Defines a subcommand for use in {@link slash}'s `subcommands` (or a group's).
 * @example
 * ```ts
 * subcommand({ description: "Show a setting", options: { key: option.string("Setting", { required: true }) } },
 *     (i, { key }) => i.reply(`Value of ${key}: ...`));
 * ```
 */
export function subcommand<O extends OptionsRecord | undefined = undefined>(
    definition: {
        description: string;
        options?: O;
        name_localizations?: Record<string, string>;
        description_localizations?: Record<string, string>;
    },
    handler: CommandHandler<O>,
): Subcommand {
    const { options, ...rest } = definition;
    const optionsJSON = optionsToJSON(options);
    return {
        json: {
            type: ApplicationCommandOptionType.Subcommand,
            ...rest,
            ...(optionsJSON.length && { options: optionsJSON }),
        } as Omit<
            APIApplicationCommandOption,
            "name"
        >,
        options,
        handler: handler as CommandHandler<OptionsRecord | undefined>,
    };
}

/**
 * Defines a slash command with typed options and a handler.
 *
 * @example
 * ```ts
 * const echo = slash({
 *     name: "echo",
 *     description: "Echoes text",
 *     options: { text: option.string("What to echo", { required: true }) },
 * }, (i, { text }) => i.reply(text));
 * ```
 */
export function slash<O extends OptionsRecord | undefined = undefined>(
    definition: CommandSettings & { name: string; description: string; options?: O },
    handler: CommandHandler<O>,
): Command;
/**
 * Defines a slash command made of subcommands (and optionally subcommand groups).
 *
 * @example
 * ```ts
 * const config = slash({
 *     name: "config",
 *     description: "Bot settings",
 *     subcommands: { show: subcommand({ description: "Show settings" }, (i) => i.reply("...")) },
 *     groups: { roles: { description: "Role settings", subcommands: { add: subcommand(...) } } },
 * });
 * ```
 */
export function slash(
    definition: CommandSettings & {
        name: string;
        description: string;
        subcommands?: Record<string, Subcommand>;
        groups?: Record<string, SubcommandGroup>;
    },
): Command;
export function slash(
    definition: CommandSettings & {
        name: string;
        description: string;
        options?: OptionsRecord;
        subcommands?: Record<string, Subcommand>;
        groups?: Record<string, SubcommandGroup>;
    },
    handler?: CommandHandler<OptionsRecord | undefined>,
): Command {
    const { options, subcommands, groups, ...settings } = definition;
    const leaves = new Map<string, Leaf>();
    let jsonOptions: APIApplicationCommandOption[];

    if (handler) {
        if (subcommands || groups) {
            throw new Error(`Slash command "${settings.name}" can't have both a handler and subcommands/groups`);
        }
        leaves.set("", { options, handler });
        jsonOptions = optionsToJSON(options);
    } else {
        jsonOptions = [];
        for (const [name, group] of Object.entries(groups ?? {})) {
            jsonOptions.push({
                type: ApplicationCommandOptionType.SubcommandGroup,
                name,
                description: group.description,
                options: Object.entries(group.subcommands).map(([subName, sub]) => {
                    leaves.set(`${name} ${subName}`, sub);
                    return { name: subName, ...sub.json };
                }),
            } as APIApplicationCommandOption);
        }
        for (const [name, sub] of Object.entries(subcommands ?? {})) {
            leaves.set(name, sub);
            jsonOptions.push({ name, ...sub.json } as APIApplicationCommandOption);
        }
        if (leaves.size === 0) throw new Error(`Slash command "${settings.name}" needs a handler or subcommands`);
    }

    const json: RESTPostAPIChatInputApplicationCommandsJSONBody = {
        ...settings,
        type: ApplicationCommandType.ChatInput,
        ...(jsonOptions.length && { options: jsonOptions }),
    };

    const leafFor = (interaction: Interaction): Leaf | undefined => {
        const path = [interaction.subcommandGroup, interaction.subcommand].filter(Boolean).join(" ");
        return leaves.get(path);
    };

    return {
        name: settings.name,
        type: ApplicationCommandType.ChatInput,
        toJSON: () => json,
        async run(interaction) {
            const leaf = leafFor(interaction);
            if (!leaf) {
                throw new Error(
                    `No handler for /${settings.name} ${interaction.subcommandGroup ?? ""} ${
                        interaction.subcommand ?? ""
                    }`,
                );
            }
            await leaf.handler(interaction, resolveOptions(interaction, leaf.options));
        },
        async autocomplete(interaction) {
            const focused = interaction.focusedOption;
            const def = focused ? leafFor(interaction)?.options?.[focused.name] : undefined;
            if (!focused || !def?.autocomplete) {
                await interaction.respondAutocomplete([]);
                return;
            }
            const handler = def.autocomplete as (i: Interaction, v: string | number) => unknown;
            const choices = await handler(interaction, focused.value as string | number) as (
                | string
                | number
                | APIApplicationCommandOptionChoice
            )[];
            await interaction.respondAutocomplete(
                choices.slice(0, 25).map((c) => (typeof c === "object" ? c : { name: String(c), value: c })),
            );
        },
    };
}

/** Settings for context menu commands. */
export type ContextMenuSettings = Omit<RESTPostAPIContextMenuApplicationCommandsJSONBody, "type" | "name">;

function contextMenu<T>(
    type: ApplicationCommandType.User | ApplicationCommandType.Message,
    definition: ContextMenuSettings & { name: string },
    handler: (interaction: Interaction, target: T) => unknown,
    resolveTarget: (
        resolved: APIInteractionDataResolved & { messages?: Record<string, APIMessage> },
        id: string,
    ) => T | undefined,
): Command {
    const json = { ...definition, type } as RESTPostAPIContextMenuApplicationCommandsJSONBody;
    return {
        name: definition.name,
        type,
        toJSON: () => json,
        async run(interaction) {
            const data = (interaction.raw as { data: { target_id: string; resolved?: object } }).data;
            const target = resolveTarget(data.resolved ?? {}, data.target_id);
            if (target === undefined) throw new Error(`Could not resolve target ${data.target_id}`);
            await handler(interaction, target);
        },
        async autocomplete() {},
    };
}

/** Defines a user context menu command ("Apps" menu on a user). The handler receives the target user. */
export function userCommand(
    definition: ContextMenuSettings & { name: string },
    handler: (interaction: Interaction, target: ResolvedUser) => unknown,
): Command {
    return contextMenu(ApplicationCommandType.User, definition, handler, (resolved, id) => {
        const user = resolved.users?.[id];
        if (!user) return undefined;
        const member = resolved.members?.[id];
        return member ? { user, member } : { user };
    });
}

/** Defines a message context menu command ("Apps" menu on a message). The handler receives the target message. */
export function messageCommand(
    definition: ContextMenuSettings & { name: string },
    handler: (interaction: Interaction, message: APIMessage) => unknown,
): Command {
    return contextMenu(ApplicationCommandType.Message, definition, handler, (resolved, id) => resolved.messages?.[id]);
}
