import { assertEquals } from "@std/assert";
import {
    ButtonStyle,
    ChannelType,
    ComponentType,
    MessageFlags,
    SeparatorSpacingSize,
    TextInputStyle,
} from "discord-api-types/v10";
import {
    button,
    channelSelect,
    checkbox,
    checkboxGroup,
    componentsV2,
    container,
    emoji,
    file,
    fileUpload,
    gallery,
    label,
    mentionableSelect,
    modal,
    radioGroup,
    roleSelect,
    row,
    section,
    separator,
    stringSelect,
    text,
    textInput,
    thumbnail,
    userSelect,
} from "../src/components/components.ts";

Deno.test("emoji parses unicode, custom, animated, and passes objects through", () => {
    assertEquals(emoji("👍"), { name: "👍" });
    assertEquals(emoji("<:name:12345>"), { name: "name", id: "12345", animated: false });
    assertEquals(emoji("<a:party:67890>"), { name: "party", id: "67890", animated: true });
    assertEquals(emoji({ name: "x", id: "1", animated: true }), { name: "x", id: "1", animated: true });
});

Deno.test("text builds a text display", () => {
    assertEquals(text("hi"), { type: ComponentType.TextDisplay, content: "hi" });
    assertEquals(text("hi", { id: 7 }), { type: ComponentType.TextDisplay, content: "hi", id: 7 });
});

Deno.test("section wraps strings and arrays of texts, keeping the accessory", () => {
    const accessory = { type: ComponentType.Thumbnail, media: { url: "https://x/y.png" } } as const;
    assertEquals(section("hello", accessory), {
        type: ComponentType.Section,
        components: [{ type: ComponentType.TextDisplay, content: "hello" }],
        accessory,
    });
    assertEquals(section([text("a"), "b"], accessory), {
        type: ComponentType.Section,
        components: [
            { type: ComponentType.TextDisplay, content: "a" },
            { type: ComponentType.TextDisplay, content: "b" },
        ],
        accessory,
    });
});

Deno.test("thumbnail builds media from the url and applies options", () => {
    assertEquals(thumbnail("https://x/y.png"), { type: ComponentType.Thumbnail, media: { url: "https://x/y.png" } });
    assertEquals(thumbnail("https://x/y.png", { description: "d", spoiler: true }), {
        type: ComponentType.Thumbnail,
        media: { url: "https://x/y.png" },
        description: "d",
        spoiler: true,
    });
});

Deno.test("gallery accepts strings and objects, moving url into media", () => {
    assertEquals(gallery("https://x/a.png"), {
        type: ComponentType.MediaGallery,
        items: [{ media: { url: "https://x/a.png" } }],
    });
    assertEquals(gallery({ url: "https://x/b.png", description: "d", spoiler: true }), {
        type: ComponentType.MediaGallery,
        items: [{ media: { url: "https://x/b.png" }, description: "d", spoiler: true }],
    });
});

Deno.test("file builds an inline file component", () => {
    assertEquals(file("attachment://a.png"), { type: ComponentType.File, file: { url: "attachment://a.png" } });
    assertEquals(file("attachment://a.png", { spoiler: true }), {
        type: ComponentType.File,
        file: { url: "attachment://a.png" },
        spoiler: true,
    });
});

Deno.test("separator defaults to a divider without spacing", () => {
    assertEquals(separator(), { type: ComponentType.Separator, divider: true });
    assertEquals(separator({ divider: false }), { type: ComponentType.Separator, divider: false });
    assertEquals(separator({ spacing: "small" }), {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
    });
    assertEquals(separator({ spacing: "large" }), {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Large,
    });
});

Deno.test("container handles options, strings as text, and accent colors", () => {
    assertEquals(container(["a"]), {
        type: ComponentType.Container,
        components: [{ type: ComponentType.TextDisplay, content: "a" }],
    });
    assertEquals(container({ accent: 0x5865f2 }, ["a"]), {
        type: ComponentType.Container,
        components: [{ type: ComponentType.TextDisplay, content: "a" }],
        accent_color: 0x5865f2,
    });
    assertEquals(container({ accent: null }, []), {
        type: ComponentType.Container,
        components: [],
        accent_color: null,
    });
    assertEquals(container([text("a")]), {
        type: ComponentType.Container,
        components: [{ type: ComponentType.TextDisplay, content: "a" }],
    });
    assertEquals(container({ spoiler: true }, ["a"]), {
        type: ComponentType.Container,
        components: [{ type: ComponentType.TextDisplay, content: "a" }],
        spoiler: true,
    });
    const noAccent = container({}, []);
    assertEquals("accent_color" in noAccent, false);
});

Deno.test("row wraps components in an action row", () => {
    assertEquals(row(button.primary("a", "A")), {
        type: ComponentType.ActionRow,
        components: [{ type: ComponentType.Button, style: ButtonStyle.Primary, custom_id: "a", label: "A" }],
    });
});

Deno.test("componentsV2 sets IsComponentsV2 and ORs extra flags while wrapping strings", () => {
    assertEquals(componentsV2(["hi"]), {
        flags: MessageFlags.IsComponentsV2,
        components: [{ type: ComponentType.TextDisplay, content: "hi" }],
    });
    assertEquals(componentsV2([text("hi")], { flags: MessageFlags.Ephemeral }), {
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [{ type: ComponentType.TextDisplay, content: "hi" }],
    });
});

Deno.test("custom-id buttons set style, custom_id, optional label and emoji", () => {
    assertEquals(button.primary("a"), { type: ComponentType.Button, style: ButtonStyle.Primary, custom_id: "a" });
    assertEquals(button.secondary("b", "B"), {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: "b",
        label: "B",
    });
    assertEquals(button.success("c", "C"), {
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        custom_id: "c",
        label: "C",
    });
    assertEquals(button.danger("d", "D"), {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        custom_id: "d",
        label: "D",
    });
    assertEquals(button.primary("e", undefined, { emoji: "👍", disabled: true }), {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        custom_id: "e",
        emoji: { name: "👍" },
        disabled: true,
    });
    assertEquals(button.primary("f", undefined, { emoji: "<a:p:5>" }).emoji, { name: "p", id: "5", animated: true });
    assertEquals("label" in button.primary("g"), false);
});

Deno.test("link buttons carry a url and no custom_id", () => {
    assertEquals(button.link("https://x"), {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        url: "https://x",
    });
    assertEquals(button.link("https://x", "X", { emoji: "👍" }), {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        url: "https://x",
        label: "X",
        emoji: { name: "👍" },
    });
    assertEquals("custom_id" in button.link("https://x"), false);
});

Deno.test("premium buttons carry a sku_id", () => {
    assertEquals(button.premium("sku-1"), {
        type: ComponentType.Button,
        style: ButtonStyle.Premium,
        sku_id: "sku-1",
    });
    assertEquals(button.premium("sku-1", { disabled: true }), {
        type: ComponentType.Button,
        style: ButtonStyle.Premium,
        sku_id: "sku-1",
        disabled: true,
    });
});

Deno.test("stringSelect maps string and object choices, converting emoji strings", () => {
    assertEquals(stringSelect("s", ["a", "b"]), {
        type: ComponentType.StringSelect,
        custom_id: "s",
        options: [{ label: "a", value: "a" }, { label: "b", value: "b" }],
    });
    assertEquals(stringSelect("s", [{ label: "L", value: "v", emoji: "👍", description: "d" }], { placeholder: "p" }), {
        type: ComponentType.StringSelect,
        custom_id: "s",
        options: [{ label: "L", value: "v", description: "d", emoji: { name: "👍" } }],
        placeholder: "p",
    });
    assertEquals(stringSelect("s", [{ label: "L", value: "v" }]), {
        type: ComponentType.StringSelect,
        custom_id: "s",
        options: [{ label: "L", value: "v" }],
    });
});

Deno.test("user, role and mentionable selects build the right component types", () => {
    assertEquals(userSelect("u", { min_values: 1, max_values: 2 }), {
        type: ComponentType.UserSelect,
        custom_id: "u",
        min_values: 1,
        max_values: 2,
    });
    assertEquals(roleSelect("r"), { type: ComponentType.RoleSelect, custom_id: "r" });
    assertEquals(mentionableSelect("m", { required: true }), {
        type: ComponentType.MentionableSelect,
        custom_id: "m",
        required: true,
    });
});

Deno.test("channelSelect maps channelTypes to channel_types", () => {
    assertEquals(channelSelect("c", { channelTypes: [ChannelType.GuildText, ChannelType.GuildVoice] }), {
        type: ComponentType.ChannelSelect,
        custom_id: "c",
        channel_types: [ChannelType.GuildText, ChannelType.GuildVoice],
    });
    assertEquals(channelSelect("c"), { type: ComponentType.ChannelSelect, custom_id: "c" });
});

Deno.test("modal wraps strings as text displays", () => {
    assertEquals(modal("m", "Title", ["note"]), {
        custom_id: "m",
        title: "Title",
        components: [{ type: ComponentType.TextDisplay, content: "note" }],
    });
    assertEquals(modal("m", "Title", [label("L", textInput("t"))]), {
        custom_id: "m",
        title: "Title",
        components: [
            {
                type: ComponentType.Label,
                label: "L",
                component: { type: ComponentType.TextInput, custom_id: "t", style: TextInputStyle.Short },
            },
        ],
    });
});

Deno.test("label wraps one modal input with an optional description", () => {
    const input = { type: ComponentType.Checkbox, custom_id: "cb" } as const;
    assertEquals(label("L", input), { type: ComponentType.Label, label: "L", component: input });
    assertEquals(label("L", input, { description: "d", id: 3 }), {
        type: ComponentType.Label,
        label: "L",
        component: input,
        description: "d",
        id: 3,
    });
});

Deno.test("textInput defaults to short style and supports paragraph", () => {
    assertEquals(textInput("t"), { type: ComponentType.TextInput, custom_id: "t", style: TextInputStyle.Short });
    assertEquals(textInput("t", { style: "paragraph" }), {
        type: ComponentType.TextInput,
        custom_id: "t",
        style: TextInputStyle.Paragraph,
    });
    assertEquals(textInput("t", { placeholder: "p", value: "v", min_length: 1, max_length: 5, required: true }), {
        type: ComponentType.TextInput,
        custom_id: "t",
        style: TextInputStyle.Short,
        placeholder: "p",
        value: "v",
        min_length: 1,
        max_length: 5,
        required: true,
    });
});

Deno.test("fileUpload builds a file upload input", () => {
    assertEquals(fileUpload("f"), { type: ComponentType.FileUpload, custom_id: "f" });
    assertEquals(fileUpload("f", { min_values: 1, max_values: 2, required: false }), {
        type: ComponentType.FileUpload,
        custom_id: "f",
        min_values: 1,
        max_values: 2,
        required: false,
    });
});

Deno.test("radioGroup maps string choices to label/value objects", () => {
    assertEquals(radioGroup("r", ["a", "b"]), {
        type: ComponentType.RadioGroup,
        custom_id: "r",
        options: [{ label: "a", value: "a" }, { label: "b", value: "b" }],
    });
    assertEquals(radioGroup("r", [{ label: "L", value: "v", description: "d" }], { required: false }), {
        type: ComponentType.RadioGroup,
        custom_id: "r",
        options: [{ label: "L", value: "v", description: "d" }],
        required: false,
    });
});

Deno.test("checkboxGroup maps string choices to label/value objects", () => {
    assertEquals(checkboxGroup("c", ["x"]), {
        type: ComponentType.CheckboxGroup,
        custom_id: "c",
        options: [{ label: "x", value: "x" }],
    });
    assertEquals(checkboxGroup("c", [{ label: "L", value: "v" }], { min_values: 1, max_values: 3 }), {
        type: ComponentType.CheckboxGroup,
        custom_id: "c",
        options: [{ label: "L", value: "v" }],
        min_values: 1,
        max_values: 3,
    });
});

Deno.test("checkbox builds a checkbox with an optional default", () => {
    assertEquals(checkbox("c"), { type: ComponentType.Checkbox, custom_id: "c" });
    assertEquals(checkbox("c", { default: true, id: 4 }), {
        type: ComponentType.Checkbox,
        custom_id: "c",
        default: true,
        id: 4,
    });
});
