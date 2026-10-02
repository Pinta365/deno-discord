import { ApplicationCommandType, type RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import type { API } from "../api/api.ts";
import type { Interaction } from "../interactions/interaction.ts";
import type { Command } from "./commands.ts";

/** Handler for a routed component or modal. `args` are the custom ID parts after the prefix. */
export type CustomIdHandler = (interaction: Interaction, args: string[]) => unknown;

/** Options for {@link CommandRouter}. */
export interface CommandRouterOptions {
    /**
     * Called when a handler throws. Defaults to logging with `console.error`.
     * Runs before the error reply below.
     */
    onError?: (error: unknown, interaction: Interaction) => unknown;
    /**
     * Ephemeral message sent to the user when a handler throws before (or after deferring) responding.
     * Set to `false` to send nothing. Defaults to `"Something went wrong."`.
     */
    errorMessage?: string | false;
}

/**
 * Registers and dispatches slash commands, context menus, autocomplete, components and modals.
 * Works with gateway bots (`client.on("INTERACTION_CREATE", (i) => router.handle(i))`) and HTTP bots
 * (`createInteractionHandler({ onInteraction: (i) => router.handle(i) })`).
 *
 * Components and modals are routed by custom ID prefix: a handler for `"vote"` matches the custom IDs
 * `"vote"` and `"vote:<args>"`, receiving the `:`-separated args.
 */
export class CommandRouter {
    readonly #commands = new Map<string, Command>();
    readonly #components = new Map<string, CustomIdHandler>();
    readonly #modals = new Map<string, CustomIdHandler>();
    readonly #onError: (error: unknown, interaction: Interaction) => unknown;
    readonly #errorMessage: string | false;

    /**
     * Creates a router.
     * @param commands Initial commands.
     * @param options Error handling options.
     */
    constructor(commands: Command[] = [], options: CommandRouterOptions = {}) {
        this.#onError = options.onError ??
            ((error, i) => console.error(`Error handling interaction ${i.commandName ?? i.customId ?? i.id}:`, error));
        this.#errorMessage = options.errorMessage ?? "Something went wrong.";
        this.add(...commands);
    }

    /** Adds commands. Names must be unique per command type. */
    add(...commands: Command[]): this {
        for (const command of commands) {
            const key = `${command.type}:${command.name}`;
            if (this.#commands.has(key)) throw new Error(`Duplicate command "${command.name}"`);
            this.#commands.set(key, command);
        }
        return this;
    }

    /** Routes button and select menu interactions whose custom ID is `prefix` or starts with `prefix:`. */
    component(prefix: string, handler: CustomIdHandler): this {
        this.#components.set(prefix, handler);
        return this;
    }

    /** Routes modal submissions whose custom ID is `prefix` or starts with `prefix:`. */
    modal(prefix: string, handler: CustomIdHandler): this {
        this.#modals.set(prefix, handler);
        return this;
    }

    /** The registered commands. */
    get commands(): Command[] {
        return [...this.#commands.values()];
    }

    /** JSON bodies for all commands, for registering with Discord. */
    toJSON(): RESTPostAPIApplicationCommandsJSONBody[] {
        return this.commands.map((c) => c.toJSON());
    }

    /**
     * Registers all commands with Discord, replacing the existing set (bulk overwrite).
     * Guild commands update instantly; global commands can take a while to appear.
     *
     * @param api The API wrapper (`client.api`, or `new API(rest)`).
     * @param applicationId The application ID (`client.applicationId` after READY).
     * @param options `guildId` to register as guild commands instead of global.
     */
    async register(api: API, applicationId: string, options: { guildId?: string } = {}): Promise<void> {
        const body = this.toJSON();
        if (options.guildId) {
            await api.applications.bulkOverwriteGuildCommands(
                applicationId,
                options.guildId,
                body as Parameters<API["applications"]["bulkOverwriteGuildCommands"]>[2],
            );
        } else {
            await api.applications.bulkOverwriteGlobalCommands(applicationId, body);
        }
    }

    /**
     * Dispatches an interaction to the matching handler.
     * @returns `true` if a handler was found (even if it threw), `false` otherwise.
     */
    async handle(interaction: Interaction): Promise<boolean> {
        let run: (() => Promise<void>) | undefined;

        if (interaction.isAutocomplete()) {
            const command = this.#commands.get(`${ApplicationCommandType.ChatInput}:${interaction.commandName}`);
            if (command) run = () => command.autocomplete(interaction);
        } else if (interaction.commandName !== undefined) {
            const type = (interaction.raw as { data: { type: ApplicationCommandType } }).data.type;
            const command = this.#commands.get(`${type}:${interaction.commandName}`);
            if (command) run = () => command.run(interaction);
        } else if (interaction.customId !== undefined) {
            const routes = interaction.isModalSubmit() ? this.#modals : this.#components;
            const match = matchCustomId(routes, interaction.customId);
            if (match) run = async () => void await match.handler(interaction, match.args);
        }

        if (!run) return false;
        try {
            await run();
        } catch (error) {
            await this.#handleError(error, interaction);
        }
        return true;
    }

    async #handleError(error: unknown, interaction: Interaction): Promise<void> {
        try {
            await this.#onError(error, interaction);
        } catch (hookError) {
            console.error("onError hook threw:", hookError);
        }
        if (this.#errorMessage === false || interaction.isAutocomplete()) return;
        try {
            if (!interaction.responded) await interaction.reply({ content: this.#errorMessage, ephemeral: true });
            else if (interaction.deferred) await interaction.editReply({ content: this.#errorMessage });
        } catch {
            // The interaction may have expired; nothing more we can do.
        }
    }
}

/** Finds the handler with the longest prefix matching `customId` (exact, or followed by `:`). */
function matchCustomId(
    routes: Map<string, CustomIdHandler>,
    customId: string,
): { handler: CustomIdHandler; args: string[] } | undefined {
    let best: { prefix: string; handler: CustomIdHandler } | undefined;
    for (const [prefix, handler] of routes) {
        if ((customId === prefix || customId.startsWith(prefix + ":")) && prefix.length > (best?.prefix.length ?? -1)) {
            best = { prefix, handler };
        }
    }
    if (!best) return undefined;
    const rest = customId.slice(best.prefix.length + 1);
    return { handler: best.handler, args: rest ? rest.split(":") : [] };
}
