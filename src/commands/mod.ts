/**
 * Command framework: define slash commands, context menus and component/modal routes with typed
 * options, register them with Discord, and dispatch interactions.
 *
 * @example
 * ```ts
 * import { CommandRouter, option, slash } from "@pinta365/discord";
 *
 * const echo = slash({
 *     name: "echo",
 *     description: "Echoes text",
 *     options: { text: option.string("What to echo", { required: true }) },
 * }, (i, { text }) => i.reply(text));
 *
 * const router = new CommandRouter([echo]);
 * client.on("READY", () => router.register(client.api, client.applicationId!, { guildId }));
 * client.on("INTERACTION_CREATE", (i) => router.handle(i));
 * ```
 * @module
 */
export {
    type Command,
    type CommandHandler,
    type CommandSettings,
    type ContextMenuSettings,
    messageCommand,
    slash,
    type Subcommand,
    subcommand,
    type SubcommandGroup,
    userCommand,
} from "./commands.ts";
export {
    type AutocompleteChoice,
    type AutocompleteHandler,
    type BaseOptionSettings,
    type BasicOptionType,
    type InferOptions,
    type IsRequired,
    type NumberOptionSettings,
    option,
    type OptionBuilders,
    type OptionDefinition,
    type OptionsRecord,
    type OptionValueMap,
    type ResolvedUser,
    type StringOptionSettings,
} from "./options.ts";
export { CommandRouter, type CommandRouterOptions, type CustomIdHandler } from "./router.ts";
