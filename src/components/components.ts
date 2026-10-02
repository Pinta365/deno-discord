/**
 * Small builder functions for message components (including Components v2) and modals.
 * Each returns a plain discord-api-types object, so builders and hand-written JSON mix freely.
 *
 * @example
 * ```ts
 * import { button, componentsV2, container, row, section, separator, text, thumbnail } from "@pinta365/discord/components";
 *
 * await interaction.reply(componentsV2([
 *     container({ accent: 0x5865f2 }, [
 *         "## Server status",
 *         section("All systems operational", thumbnail("https://example.com/ok.png")),
 *         separator(),
 *         row(button.primary("refresh", "Refresh"), button.link("https://status.example.com", "Details")),
 *     ]),
 * ]));
 * ```
 * @module
 */
import {
    type APIActionRowComponent,
    type APIButtonComponentWithCustomId,
    type APIButtonComponentWithSKUId,
    type APIButtonComponentWithURL,
    type APIChannelSelectComponent,
    type APICheckboxComponent,
    type APICheckboxGroupComponent,
    type APICheckboxGroupOption,
    type APIComponentInContainer,
    type APIComponentInLabel,
    type APIComponentInMessageActionRow,
    type APIContainerComponent,
    type APIFileComponent,
    type APIFileUploadComponent,
    type APILabelComponent,
    type APIMediaGalleryComponent,
    type APIMediaGalleryItem,
    type APIMentionableSelectComponent,
    type APIMessageComponentEmoji,
    type APIMessageTopLevelComponent,
    type APIModalInteractionResponseCallbackData,
    type APIRadioGroupComponent,
    type APIRadioGroupOption,
    type APIRoleSelectComponent,
    type APISectionAccessoryComponent,
    type APISectionComponent,
    type APISelectMenuOption,
    type APISeparatorComponent,
    type APIStringSelectComponent,
    type APITextDisplayComponent,
    type APITextInputComponent,
    type APIThumbnailComponent,
    type APIUserSelectComponent,
    ButtonStyle,
    type ChannelType,
    ComponentType,
    MessageFlags,
    SeparatorSpacingSize,
    TextInputStyle,
} from "discord-api-types/v10";

/** An emoji: a unicode emoji (`"👍"`), a custom emoji mention (`"<:name:id>"`, `"<a:name:id>"`), or an object. */
export type EmojiInput = string | APIMessageComponentEmoji;

/** Text accepted where a text display is expected: a markdown string or a text display component. */
export type TextInput = string | APITextDisplayComponent;

/** Children accepted by {@link container}: components, or strings (turned into text displays). */
export type ContainerChild = string | APIComponentInContainer;

/** Converts an {@link EmojiInput} to the component emoji shape. */
export function emoji(input: EmojiInput): APIMessageComponentEmoji {
    if (typeof input !== "string") return input;
    const custom = /^<(a)?:(\w+):(\d+)>$/.exec(input);
    if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };
    return { name: input };
}

// --- layout & content (Components v2) ------------------------------------------------------------

/** A text display (markdown supported). */
export function text(content: string, options: { id?: number } = {}): APITextDisplayComponent {
    return { type: ComponentType.TextDisplay, content, ...options };
}

function toText(input: TextInput): APITextDisplayComponent {
    return typeof input === "string" ? text(input) : input;
}

/**
 * A section: 1–3 text displays with an accessory (a {@link thumbnail} or a button) on the right.
 * @param texts One text, or up to three.
 * @param accessory Thumbnail or button.
 */
export function section(
    texts: TextInput | TextInput[],
    accessory: APISectionAccessoryComponent,
    options: { id?: number } = {},
): APISectionComponent {
    const list = Array.isArray(texts) ? texts : [texts];
    return { type: ComponentType.Section, components: list.map(toText), accessory, ...options };
}

/** A thumbnail, for use as a {@link section} accessory. Use `attachment://name.png` for uploaded files. */
export function thumbnail(
    url: string,
    options: { description?: string; spoiler?: boolean; id?: number } = {},
): APIThumbnailComponent {
    return { type: ComponentType.Thumbnail, media: { url }, ...options };
}

/** A media gallery of 1–10 images/videos. Items are URLs or `{ url, description, spoiler }`. */
export function gallery(
    ...items: (string | { url: string; description?: string; spoiler?: boolean })[]
): APIMediaGalleryComponent {
    return {
        type: ComponentType.MediaGallery,
        items: items.map((item): APIMediaGalleryItem => {
            if (typeof item === "string") return { media: { url: item } };
            const { url, ...rest } = item;
            return { media: { url }, ...rest };
        }),
    };
}

/** An uploaded file shown inline. `url` must be `attachment://<filename>` of a file sent with the message. */
export function file(url: string, options: { spoiler?: boolean; id?: number } = {}): APIFileComponent {
    return { type: ComponentType.File, file: { url }, ...options };
}

/** Vertical spacing, with a divider line by default. */
export function separator(
    options: { divider?: boolean; spacing?: "small" | "large"; id?: number } = {},
): APISeparatorComponent {
    const { spacing, ...rest } = options;
    return {
        type: ComponentType.Separator,
        divider: true,
        ...(spacing && { spacing: spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small }),
        ...rest,
    };
}

/**
 * A container: a box (like an embed) around other components, with an optional accent color.
 * Strings in `children` become text displays.
 */
export function container(
    options: { accent?: number | null; spoiler?: boolean; id?: number },
    children: ContainerChild[],
): APIContainerComponent;
/** A container without options. */
export function container(children: ContainerChild[]): APIContainerComponent;
export function container(
    a: { accent?: number | null; spoiler?: boolean; id?: number } | ContainerChild[],
    b?: ContainerChild[],
): APIContainerComponent {
    const [options, children] = Array.isArray(a) ? [{}, a] : [a, b ?? []];
    const { accent, ...rest } = options as { accent?: number | null; spoiler?: boolean; id?: number };
    return {
        type: ComponentType.Container,
        components: children.map((c) => (typeof c === "string" ? text(c) : c)),
        ...(accent !== undefined && { accent_color: accent }),
        ...rest,
    };
}

/** An action row of up to 5 buttons, or a single select menu. */
export function row(
    ...components: APIComponentInMessageActionRow[]
): APIActionRowComponent<APIComponentInMessageActionRow> {
    return { type: ComponentType.ActionRow, components };
}

/**
 * Makes a Components v2 message payload: sets the `IsComponentsV2` flag and the components.
 * Spread into reply/send payloads; `content` and `embeds` can't be used with v2 messages.
 *
 * @example
 * ```ts
 * await interaction.reply({ ...componentsV2([text("Hi")]), ephemeral: true });
 * await client.api.channels.createMessage(channelId, componentsV2([container([text("Report")])]));
 * ```
 */
export function componentsV2(
    components: (string | APIMessageTopLevelComponent)[],
    options: { flags?: number } = {},
): { flags: number; components: APIMessageTopLevelComponent[] } {
    return {
        flags: (options.flags ?? 0) | MessageFlags.IsComponentsV2,
        components: components.map((c) => (typeof c === "string" ? text(c) : c)),
    };
}

// --- buttons --------------------------------------------------------------------------------------

/** Options shared by all buttons. */
export interface ButtonOptions {
    /** Emoji shown on the button. */
    emoji?: EmojiInput;
    /** Whether the button is disabled. */
    disabled?: boolean;
    /** Optional component ID. */
    id?: number;
}

type CustomIdStyle = ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger;

function customIdButton(
    style: CustomIdStyle,
    customId: string,
    label?: string,
    options: ButtonOptions = {},
): APIButtonComponentWithCustomId {
    const { emoji: e, ...rest } = options;
    return {
        type: ComponentType.Button,
        style,
        custom_id: customId,
        ...(label !== undefined && { label }),
        ...(e !== undefined && { emoji: emoji(e) }),
        ...rest,
    };
}

/** Button builders, by style. */
export const button: {
    /** Blurple button. */
    primary(customId: string, label?: string, options?: ButtonOptions): APIButtonComponentWithCustomId;
    /** Grey button. */
    secondary(customId: string, label?: string, options?: ButtonOptions): APIButtonComponentWithCustomId;
    /** Green button. */
    success(customId: string, label?: string, options?: ButtonOptions): APIButtonComponentWithCustomId;
    /** Red button. */
    danger(customId: string, label?: string, options?: ButtonOptions): APIButtonComponentWithCustomId;
    /** Link button; opens a URL and sends no interaction. */
    link(url: string, label?: string, options?: ButtonOptions): APIButtonComponentWithURL;
    /** Premium button for purchasing an SKU. */
    premium(skuId: string, options?: { disabled?: boolean; id?: number }): APIButtonComponentWithSKUId;
} = {
    primary: (customId, label, options) => customIdButton(ButtonStyle.Primary, customId, label, options),
    secondary: (customId, label, options) => customIdButton(ButtonStyle.Secondary, customId, label, options),
    success: (customId, label, options) => customIdButton(ButtonStyle.Success, customId, label, options),
    danger: (customId, label, options) => customIdButton(ButtonStyle.Danger, customId, label, options),
    link(url, label, options = {}) {
        const { emoji: e, ...rest } = options;
        return {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            url,
            ...(label !== undefined && { label }),
            ...(e !== undefined && { emoji: emoji(e) }),
            ...rest,
        };
    },
    premium: (skuId, options = {}) => ({
        type: ComponentType.Button,
        style: ButtonStyle.Premium,
        sku_id: skuId,
        ...options,
    }),
};

// --- select menus ---------------------------------------------------------------------------------

/** Options shared by select menus. */
export interface SelectOptions {
    /** Placeholder text when nothing is selected. */
    placeholder?: string;
    /** Minimum selections (0–25). */
    min_values?: number;
    /** Maximum selections (1–25). */
    max_values?: number;
    /** Whether the menu is disabled (messages only). */
    disabled?: boolean;
    /** Whether a selection is required (modals only). */
    required?: boolean;
    /** Optional component ID. */
    id?: number;
}

/** A select option: a string (used as label and value) or an option object with an optional emoji string. */
export type SelectOptionInput = string | (Omit<APISelectMenuOption, "emoji"> & { emoji?: EmojiInput });

/** A select menu with your own options. */
export function stringSelect(
    customId: string,
    choices: SelectOptionInput[],
    options: SelectOptions = {},
): APIStringSelectComponent {
    return {
        type: ComponentType.StringSelect,
        custom_id: customId,
        options: choices.map((c): APISelectMenuOption => {
            if (typeof c === "string") return { label: c, value: c };
            const { emoji: e, ...rest } = c;
            return e === undefined ? rest : { ...rest, emoji: emoji(e) };
        }),
        ...options,
    };
}

/** A select menu of users. */
export function userSelect(customId: string, options: SelectOptions = {}): APIUserSelectComponent {
    return { type: ComponentType.UserSelect, custom_id: customId, ...options };
}

/** A select menu of roles. */
export function roleSelect(customId: string, options: SelectOptions = {}): APIRoleSelectComponent {
    return { type: ComponentType.RoleSelect, custom_id: customId, ...options };
}

/** A select menu of users and roles. */
export function mentionableSelect(customId: string, options: SelectOptions = {}): APIMentionableSelectComponent {
    return { type: ComponentType.MentionableSelect, custom_id: customId, ...options };
}

/** A select menu of channels, optionally limited to some channel types. */
export function channelSelect(
    customId: string,
    options: SelectOptions & { channelTypes?: ChannelType[] } = {},
): APIChannelSelectComponent {
    const { channelTypes, ...rest } = options;
    return {
        type: ComponentType.ChannelSelect,
        custom_id: customId,
        ...(channelTypes && { channel_types: channelTypes }),
        ...rest,
    };
}

// --- modals ---------------------------------------------------------------------------------------

/**
 * A modal for {@link Interaction.showModal}. Children are usually {@link label}s wrapping inputs;
 * read submitted values with `interaction.modalValues`.
 */
export function modal(
    customId: string,
    title: string,
    components: (APILabelComponent | APITextDisplayComponent | string)[],
): APIModalInteractionResponseCallbackData {
    return {
        custom_id: customId,
        title,
        components: components.map((c) => (typeof c === "string" ? text(c) : c)),
    };
}

/** A label with an optional description around one modal input. */
export function label(
    labelText: string,
    component: APIComponentInLabel,
    options: { description?: string; id?: number } = {},
): APILabelComponent {
    return { type: ComponentType.Label, label: labelText, component, ...options };
}

/** A text input for modals. Wrap it in a {@link label}. */
export function textInput(
    customId: string,
    options: {
        style?: "short" | "paragraph";
        placeholder?: string;
        value?: string;
        min_length?: number;
        max_length?: number;
        required?: boolean;
        id?: number;
    } = {},
): APITextInputComponent {
    const { style, ...rest } = options;
    return {
        type: ComponentType.TextInput,
        custom_id: customId,
        style: style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short,
        ...rest,
    };
}

/** A file upload input for modals. Wrap it in a {@link label}. */
export function fileUpload(
    customId: string,
    options: Omit<APIFileUploadComponent, "type" | "custom_id"> = {},
): APIFileUploadComponent {
    return { type: ComponentType.FileUpload, custom_id: customId, ...options };
}

/** A single-choice radio group for modals. Wrap it in a {@link label}. */
export function radioGroup(
    customId: string,
    choices: (string | APIRadioGroupOption)[],
    options: { required?: boolean; id?: number } = {},
): APIRadioGroupComponent {
    return {
        type: ComponentType.RadioGroup,
        custom_id: customId,
        options: choices.map((c) => (typeof c === "string" ? { label: c, value: c } : c)),
        ...options,
    };
}

/** A multi-choice checkbox group for modals. Wrap it in a {@link label}. */
export function checkboxGroup(
    customId: string,
    choices: (string | APICheckboxGroupOption)[],
    options: { min_values?: number; max_values?: number; required?: boolean; id?: number } = {},
): APICheckboxGroupComponent {
    return {
        type: ComponentType.CheckboxGroup,
        custom_id: customId,
        options: choices.map((c) => (typeof c === "string" ? { label: c, value: c } : c)),
        ...options,
    };
}

/** A single checkbox for modals. Wrap it in a {@link label}. */
export function checkbox(customId: string, options: { default?: boolean; id?: number } = {}): APICheckboxComponent {
    return { type: ComponentType.Checkbox, custom_id: customId, ...options };
}
