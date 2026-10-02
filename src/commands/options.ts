import {
    type APIApplicationCommandBasicOption,
    type APIApplicationCommandOptionChoice,
    type APIAttachment,
    type APIInteractionDataResolved,
    type APIInteractionDataResolvedChannel,
    type APIInteractionDataResolvedGuildMember,
    type APIRole,
    type APIUser,
    ApplicationCommandOptionType,
    type ChannelType,
} from "discord-api-types/v10";
import type { Interaction } from "../interactions/interaction.ts";

/** A resolved user option: the user, plus their member object when used in a guild. */
export interface ResolvedUser {
    /** The user. */
    user: APIUser;
    /** The guild member, if the command was used in a guild and the user is a member. */
    member?: APIInteractionDataResolvedGuildMember;
}

/** Maps an option type to the value handlers receive. */
export interface OptionValueMap {
    [ApplicationCommandOptionType.String]: string;
    [ApplicationCommandOptionType.Integer]: number;
    [ApplicationCommandOptionType.Number]: number;
    [ApplicationCommandOptionType.Boolean]: boolean;
    [ApplicationCommandOptionType.User]: ResolvedUser;
    [ApplicationCommandOptionType.Channel]: APIInteractionDataResolvedChannel;
    [ApplicationCommandOptionType.Role]: APIRole;
    [ApplicationCommandOptionType.Mentionable]: ResolvedUser | APIRole;
    [ApplicationCommandOptionType.Attachment]: APIAttachment;
}

/** Option types that can be command options (not subcommands). */
export type BasicOptionType = keyof OptionValueMap;

/** A choice for autocomplete results: a plain value (used as name too) or `{ name, value }`. */
export type AutocompleteChoice<V extends string | number> = V | { name: string; value: V };

/** Autocomplete handler: gets the focused value and returns up to 25 choices. */
export type AutocompleteHandler<V extends string | number> = (
    interaction: Interaction,
    value: V,
) => AutocompleteChoice<V>[] | Promise<AutocompleteChoice<V>[]>;

/**
 * An option definition created by the {@link option} helpers. The option's name is the key it is
 * stored under in the command's `options` object.
 */
export interface OptionDefinition<T extends BasicOptionType = BasicOptionType, R extends boolean = boolean> {
    /** Option type. */
    readonly type: T;
    /** Whether the option is required. */
    readonly required: R;
    /** The option JSON, without `name` (filled in from the key). */
    readonly json: Omit<APIApplicationCommandBasicOption, "name">;
    /** Autocomplete handler, for string/integer/number options. */
    readonly autocomplete?: AutocompleteHandler<string> | AutocompleteHandler<number>;
}

/** A record of option definitions, keyed by option name. */
export type OptionsRecord = Record<string, OptionDefinition>;

/** The options object a handler receives, inferred from the definitions. Optional options may be `undefined`. */
export type InferOptions<O extends OptionsRecord | undefined> = O extends OptionsRecord ? {
        [K in keyof O]: O[K] extends OptionDefinition<infer T, infer R>
            ? R extends true ? OptionValueMap[T] : OptionValueMap[T] | undefined
            : never;
    }
    // deno-lint-ignore ban-types
    : {};

/** Common settings for every option. */
export interface BaseOptionSettings {
    /** Whether the option must be filled in. Required options must come before optional ones. */
    required?: boolean;
    /** Localized names, by locale. */
    name_localizations?: Record<string, string>;
    /** Localized descriptions, by locale. */
    description_localizations?: Record<string, string>;
}

/** Settings for string options. */
export interface StringOptionSettings extends BaseOptionSettings {
    /** Fixed choices: strings, or `{ name, value }`. Can't be combined with `autocomplete`. */
    choices?: (string | APIApplicationCommandOptionChoice<string>)[];
    /** Minimum length (0–6000). */
    min_length?: number;
    /** Maximum length (1–6000). */
    max_length?: number;
    /** Suggest values as the user types. */
    autocomplete?: AutocompleteHandler<string>;
}

/** Settings for integer and number options. */
export interface NumberOptionSettings extends BaseOptionSettings {
    /** Fixed choices: numbers, or `{ name, value }`. Can't be combined with `autocomplete`. */
    choices?: (number | APIApplicationCommandOptionChoice<number>)[];
    /** Minimum value. */
    min_value?: number;
    /** Maximum value. */
    max_value?: number;
    /** Suggest values as the user types. */
    autocomplete?: AutocompleteHandler<number>;
}

/** `true` if the settings literally say `required: true`. */
export type IsRequired<S> = S extends { required: true } ? true : false;

function define<T extends BasicOptionType, R extends boolean>(
    type: T,
    description: string,
    settings: BaseOptionSettings & Record<string, unknown> = {},
): OptionDefinition<T, R> {
    const { required, autocomplete, choices, ...rest } = settings as BaseOptionSettings & {
        autocomplete?: AutocompleteHandler<string> | AutocompleteHandler<number>;
        choices?: (string | number | APIApplicationCommandOptionChoice)[];
    };
    const json = {
        type,
        description,
        ...(required && { required: true }),
        ...(autocomplete && { autocomplete: true }),
        ...(choices && {
            choices: choices.map((c) => (typeof c === "object" ? c : { name: String(c), value: c })),
        }),
        ...rest,
    } as Omit<APIApplicationCommandBasicOption, "name">;
    return { type, required: Boolean(required) as R, json, ...(autocomplete && { autocomplete }) };
}

/**
 * Option builders. The option name is the key in the command's `options` object.
 *
 * @example
 * ```ts
 * options: {
 *     text: option.string("What to say", { required: true, max_length: 200 }),
 *     times: option.integer("How many times", { min_value: 1, max_value: 5 }),
 *     target: option.user("Who to mention"),
 * }
 * ```
 */
/** The option builder functions; see {@link option}. */
export interface OptionBuilders {
    /** A text option. */
    string<const S extends StringOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & StringOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.String, IsRequired<S>>;
    /** A whole-number option. */
    integer<const S extends NumberOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & NumberOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Integer, IsRequired<S>>;
    /** A decimal-number option. */
    number<const S extends NumberOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & NumberOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Number, IsRequired<S>>;
    /** A true/false option. */
    boolean<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Boolean, IsRequired<S>>;
    /** A user option; the handler receives `{ user, member? }`. */
    user<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.User, IsRequired<S>>;
    /** A channel option, optionally limited to some channel types. */
    channel<const S extends BaseOptionSettings & { channel_types?: ChannelType[] } = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings & { channel_types?: ChannelType[] },
    ): OptionDefinition<ApplicationCommandOptionType.Channel, IsRequired<S>>;
    /** A role option. */
    role<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Role, IsRequired<S>>;
    /** A user-or-role option. */
    mentionable<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Mentionable, IsRequired<S>>;
    /** A file upload option. */
    attachment<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Attachment, IsRequired<S>>;
}

export const option: OptionBuilders = {
    /** A text option. */
    string<const S extends StringOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & StringOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.String, IsRequired<S>> {
        return define(ApplicationCommandOptionType.String, description, settings as Record<string, unknown>);
    },
    /** A whole-number option. */
    integer<const S extends NumberOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & NumberOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Integer, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Integer, description, settings as Record<string, unknown>);
    },
    /** A decimal-number option. */
    number<const S extends NumberOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & NumberOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Number, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Number, description, settings as Record<string, unknown>);
    },
    /** A true/false option. */
    boolean<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Boolean, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Boolean, description, settings as Record<string, unknown>);
    },
    /** A user option; the handler receives `{ user, member? }`. */
    user<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.User, IsRequired<S>> {
        return define(ApplicationCommandOptionType.User, description, settings as Record<string, unknown>);
    },
    /** A channel option, optionally limited to some channel types. */
    channel<const S extends BaseOptionSettings & { channel_types?: ChannelType[] } = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings & { channel_types?: ChannelType[] },
    ): OptionDefinition<ApplicationCommandOptionType.Channel, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Channel, description, settings as Record<string, unknown>);
    },
    /** A role option. */
    role<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Role, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Role, description, settings as Record<string, unknown>);
    },
    /** A user-or-role option. */
    mentionable<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Mentionable, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Mentionable, description, settings as Record<string, unknown>);
    },
    /** A file upload option. */
    attachment<const S extends BaseOptionSettings = Record<never, never>>(
        description: string,
        settings?: S & BaseOptionSettings,
    ): OptionDefinition<ApplicationCommandOptionType.Attachment, IsRequired<S>> {
        return define(ApplicationCommandOptionType.Attachment, description, settings as Record<string, unknown>);
    },
};

/** Builds the API option list from an options record (names come from the keys). */
export function optionsToJSON(options: OptionsRecord | undefined): APIApplicationCommandBasicOption[] {
    return Object.entries(options ?? {}).map(([name, def]) =>
        ({ name, ...def.json }) as APIApplicationCommandBasicOption
    );
}

/**
 * Resolves an interaction's leaf options into the typed object a handler receives.
 * User/role/channel/mentionable/attachment IDs are replaced with their resolved objects.
 */
export function resolveOptions<O extends OptionsRecord | undefined>(
    interaction: Interaction,
    options: O,
): InferOptions<O> {
    const resolved =
        ("data" in interaction.raw
            ? (interaction.raw.data as { resolved?: APIInteractionDataResolved }).resolved
            : undefined) ?? {};
    const values: Record<string, unknown> = {};
    for (const [name, def] of Object.entries((options ?? {}) as OptionsRecord)) {
        const raw = interaction.getOption(name);
        if (raw === undefined) {
            values[name] = undefined;
            continue;
        }
        const id = String(raw);
        switch (def.type) {
            case ApplicationCommandOptionType.User:
                values[name] = resolveUser(resolved, id);
                break;
            case ApplicationCommandOptionType.Role:
                values[name] = resolved.roles?.[id];
                break;
            case ApplicationCommandOptionType.Channel:
                values[name] = resolved.channels?.[id];
                break;
            case ApplicationCommandOptionType.Attachment:
                values[name] = resolved.attachments?.[id];
                break;
            case ApplicationCommandOptionType.Mentionable:
                values[name] = resolved.users?.[id] ? resolveUser(resolved, id) : resolved.roles?.[id];
                break;
            default:
                values[name] = raw;
        }
    }
    return values as InferOptions<O>;
}

function resolveUser(resolved: APIInteractionDataResolved, id: string): ResolvedUser | undefined {
    const user = resolved.users?.[id];
    if (!user) return undefined;
    const member = resolved.members?.[id];
    return member ? { user, member } : { user };
}
