import {
    type APIApplicationCommandInteractionDataOption,
    type APIApplicationCommandOptionChoice,
    type APIInteraction,
    type APIInteractionResponse,
    type APIInteractionResponseCallbackData,
    type APIMessage,
    type APIModalInteractionResponseCallbackData,
    type APIUser,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ComponentType,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
    Routes,
} from "discord-api-types/v10";
import type { RawFile, RestClient } from "../rest/rest.ts";

/** Message content accepted by the reply helpers: a string, or a full payload with optional files. */
export type ReplyOptions = string | (APIInteractionResponseCallbackData & { files?: RawFile[]; ephemeral?: boolean });

/** Sends the initial interaction response. Gateway bots POST it; HTTP bots return it as the HTTP response. */
export type InitialResponder = (response: APIInteractionResponse, files?: RawFile[]) => Promise<void>;

/** A submitted modal input value. See {@link Interaction.modalValues}. */
export type ModalValue = string | string[] | boolean | null;

/** A resolved command option value. */
export type OptionValue = string | number | boolean;

/**
 * A received interaction with helpers for responding.
 *
 * The first response must happen within 3 seconds. Use {@link Interaction.deferReply} or
 * {@link Interaction.deferUpdate} for slower work, then {@link Interaction.editReply}.
 */
export class Interaction {
    /** The raw interaction payload. */
    readonly raw: APIInteraction;
    /** Whether an initial response (reply, defer, update, modal) has been sent. */
    responded = false;
    /** Whether the initial response was a defer. */
    deferred = false;

    readonly #rest: RestClient;
    readonly #respond: InitialResponder;

    /**
     * Wraps a raw interaction.
     * @param raw Interaction payload from Discord.
     * @param rest REST client used for follow-ups and edits.
     * @param respond How to deliver the initial response. Defaults to the REST callback endpoint.
     */
    constructor(raw: APIInteraction, rest: RestClient, respond?: InitialResponder) {
        this.raw = raw;
        this.#rest = rest;
        this.#respond = respond ??
            (async (body, files) => {
                await rest.post(Routes.interactionCallback(raw.id, raw.token), { body, files, auth: false });
            });
    }

    // --- accessors -----------------------------------------------------------------------------

    /** Interaction ID. */
    get id(): string {
        return this.raw.id;
    }
    /** Interaction type. */
    get type(): InteractionType {
        return this.raw.type;
    }
    /** Continuation token (valid for 15 minutes). */
    get token(): string {
        return this.raw.token;
    }
    /** Application ID. */
    get applicationId(): string {
        return this.raw.application_id;
    }
    /** Guild ID, if invoked in a guild. */
    get guildId(): string | undefined {
        return this.raw.guild_id;
    }
    /** Channel ID, if available. */
    get channelId(): string | undefined {
        return this.raw.channel?.id ?? this.raw.channel_id;
    }
    /** The invoking user (from `member.user` in guilds, `user` in DMs). */
    get user(): APIUser {
        return (this.raw.member?.user ?? this.raw.user)!;
    }
    /** The invoking user's locale. */
    get locale(): string | undefined {
        return "locale" in this.raw ? this.raw.locale : undefined;
    }

    /** Command name for application command and autocomplete interactions. */
    get commandName(): string | undefined {
        return this.#isCommandLike() ? (this.raw.data as { name: string }).name : undefined;
    }
    /** Custom ID for component and modal interactions. */
    get customId(): string | undefined {
        return this.isMessageComponent() || this.isModalSubmit() ? this.raw.data.custom_id : undefined;
    }

    // --- type checks ---------------------------------------------------------------------------

    /** Whether this is a slash (chat input) command. */
    isChatInputCommand(): boolean {
        return this.raw.type === InteractionType.ApplicationCommand &&
            this.raw.data.type === ApplicationCommandType.ChatInput;
    }
    /** Whether this is a user context menu command. */
    isUserCommand(): boolean {
        return this.raw.type === InteractionType.ApplicationCommand &&
            this.raw.data.type === ApplicationCommandType.User;
    }
    /** Whether this is a message context menu command. */
    isMessageCommand(): boolean {
        return this.raw.type === InteractionType.ApplicationCommand &&
            this.raw.data.type === ApplicationCommandType.Message;
    }
    /** Whether this is an autocomplete request. */
    isAutocomplete(): boolean {
        return this.raw.type === InteractionType.ApplicationCommandAutocomplete;
    }
    /** Whether this came from a message component (button, select menu). */
    isMessageComponent(): this is Interaction & {
        raw: Extract<APIInteraction, { type: InteractionType.MessageComponent }>;
    } {
        return this.raw.type === InteractionType.MessageComponent;
    }
    /** Whether this came from a button. */
    isButton(): boolean {
        return this.isMessageComponent() && this.raw.data.component_type === ComponentType.Button;
    }
    /** Whether this came from any select menu. */
    isSelectMenu(): boolean {
        return this.isMessageComponent() && this.raw.data.component_type !== ComponentType.Button;
    }
    /** Whether this is a modal submission. */
    isModalSubmit(): this is Interaction & { raw: Extract<APIInteraction, { type: InteractionType.ModalSubmit }> } {
        return this.raw.type === InteractionType.ModalSubmit;
    }

    // --- options -------------------------------------------------------------------------------

    /** Subcommand group name, if any. */
    get subcommandGroup(): string | undefined {
        return this.#rootOptions().find((o) => o.type === ApplicationCommandOptionType.SubcommandGroup)?.name;
    }

    /** Subcommand name, if any. */
    get subcommand(): string | undefined {
        let opts = this.#rootOptions();
        const group = opts.find((o) => o.type === ApplicationCommandOptionType.SubcommandGroup);
        if (group && "options" in group) opts = group.options ?? [];
        return opts.find((o) => o.type === ApplicationCommandOptionType.Subcommand)?.name;
    }

    /** The resolved leaf options (inside any subcommand/group). */
    get options(): APIApplicationCommandInteractionDataOption[] {
        let opts = this.#rootOptions();
        for (let i = 0; i < 2; i++) {
            const nested = opts.find((o) =>
                o.type === ApplicationCommandOptionType.SubcommandGroup ||
                o.type === ApplicationCommandOptionType.Subcommand
            );
            if (!nested || !("options" in nested)) break;
            opts = (nested.options ?? []) as APIApplicationCommandInteractionDataOption[];
        }
        return opts;
    }

    /**
     * Gets an option's value by name.
     * For user/channel/role/mentionable/attachment options this is the ID; look it up in `raw.data.resolved`.
     */
    getOption<T extends OptionValue = OptionValue>(name: string): T | undefined {
        const opt = this.options.find((o) => o.name === name);
        return opt && "value" in opt ? opt.value as T : undefined;
    }

    /** For autocomplete: the option the user is currently typing in. */
    get focusedOption(): { name: string; value: OptionValue } | undefined {
        const opt = this.options.find((o) => "focused" in o && o.focused);
        return opt && "value" in opt ? { name: opt.name, value: opt.value } : undefined;
    }

    /**
     * For modal submits: every submitted input's value, keyed by custom ID.
     * - text input, radio group: `string` (radio is `null` when nothing is picked)
     * - select menus, checkbox group, file upload: `string[]` (file upload values are attachment IDs in `raw.data.resolved`)
     * - checkbox: `boolean`
     */
    get modalValues(): Record<string, ModalValue> {
        const values: Record<string, ModalValue> = {};
        if (!this.isModalSubmit()) return values;
        const walk = (components: unknown[]): void => {
            for (const c of components as Record<string, unknown>[]) {
                if (typeof c.custom_id === "string") {
                    if ("value" in c) values[c.custom_id] = c.value as ModalValue;
                    else if (Array.isArray(c.values)) values[c.custom_id] = c.values as string[];
                }
                if (Array.isArray(c.components)) walk(c.components);
                if (c.component && typeof c.component === "object") walk([c.component]);
            }
        };
        walk(this.raw.data.components);
        return values;
    }

    /** For modal submits: a text input's (or radio group's) value as a string, if present. */
    getModalText(customId: string): string | undefined {
        const value = this.modalValues[customId];
        return typeof value === "string" ? value : undefined;
    }

    // --- responses -----------------------------------------------------------------------------

    /**
     * Sends the initial reply. If the interaction was already deferred, edits the deferred reply instead.
     * @param options Content string or message payload. `ephemeral: true` makes it visible only to the user.
     */
    async reply(options: ReplyOptions): Promise<void> {
        const { data, files } = normalize(options);
        if (this.deferred) {
            await this.editReply(options);
            return;
        }
        this.#assertNotResponded();
        this.responded = true;
        await this.#respond({ type: InteractionResponseType.ChannelMessageWithSource, data }, files);
    }

    /** Acknowledges the interaction; the user sees "thinking…". Follow with {@link Interaction.editReply}. */
    async deferReply(options: { ephemeral?: boolean } = {}): Promise<void> {
        this.#assertNotResponded();
        this.responded = this.deferred = true;
        await this.#respond({
            type: InteractionResponseType.DeferredChannelMessageWithSource,
            data: options.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
        });
    }

    /** Component interactions only: edits the message the component is attached to. */
    async update(options: ReplyOptions): Promise<void> {
        const { data, files } = normalize(options);
        if (this.deferred) {
            await this.editReply(options);
            return;
        }
        this.#assertNotResponded();
        this.responded = true;
        await this.#respond({ type: InteractionResponseType.UpdateMessage, data }, files);
    }

    /** Component interactions only: acknowledges without changing the message yet. */
    async deferUpdate(): Promise<void> {
        this.#assertNotResponded();
        this.responded = this.deferred = true;
        await this.#respond({ type: InteractionResponseType.DeferredMessageUpdate });
    }

    /** Opens a modal dialog. Not allowed after deferring. */
    async showModal(modal: APIModalInteractionResponseCallbackData): Promise<void> {
        this.#assertNotResponded();
        this.responded = true;
        await this.#respond({ type: InteractionResponseType.Modal, data: modal });
    }

    /** Autocomplete only: returns up to 25 suggestions. */
    async respondAutocomplete(choices: APIApplicationCommandOptionChoice[]): Promise<void> {
        this.#assertNotResponded();
        this.responded = true;
        await this.#respond({
            type: InteractionResponseType.ApplicationCommandAutocompleteResult,
            data: { choices: choices.slice(0, 25) },
        });
    }

    /** Edits the original response (or fills in a deferred one). */
    async editReply(options: ReplyOptions): Promise<APIMessage> {
        const { data, files } = normalize(options);
        return await this.#rest.patch(Routes.webhookMessage(this.applicationId, this.token), {
            body: data,
            files,
            auth: false,
        });
    }

    /** Fetches the original response message. */
    async fetchReply(): Promise<APIMessage> {
        return await this.#rest.get(Routes.webhookMessage(this.applicationId, this.token), { auth: false });
    }

    /** Deletes the original response. */
    async deleteReply(): Promise<void> {
        await this.#rest.delete(Routes.webhookMessage(this.applicationId, this.token), { auth: false });
    }

    /** Sends an additional message after the initial response. */
    async followUp(options: ReplyOptions): Promise<APIMessage> {
        const { data, files } = normalize(options);
        return await this.#rest.post(Routes.webhook(this.applicationId, this.token), {
            body: data,
            files,
            query: { wait: true },
            auth: false,
        });
    }

    #assertNotResponded(): void {
        if (this.responded) throw new Error(`Interaction ${this.id} has already been responded to`);
    }

    #isCommandLike(): boolean {
        return this.raw.type === InteractionType.ApplicationCommand ||
            this.raw.type === InteractionType.ApplicationCommandAutocomplete;
    }

    #rootOptions(): APIApplicationCommandInteractionDataOption[] {
        if (!this.#isCommandLike()) return [];
        const data = this.raw.data as { options?: APIApplicationCommandInteractionDataOption[] };
        return data.options ?? [];
    }
}

function normalize(options: ReplyOptions): { data: APIInteractionResponseCallbackData; files?: RawFile[] } {
    if (typeof options === "string") return { data: { content: options } };
    const { files, ephemeral, ...data } = options;
    if (ephemeral) data.flags = (Number(data.flags ?? 0) | MessageFlags.Ephemeral) as typeof data.flags;
    if (files?.length && !data.attachments) {
        data.attachments = files.map((f, i) => ({ id: i, filename: f.name }));
    }
    return { data, files };
}
