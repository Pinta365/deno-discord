// Commands shared by the example bots (gateway and HTTP), built with the command framework.
import { CommandRouter, messageCommand, option, slash, subcommand, userCommand } from "../mod.ts";
import { button, label, modal, radioGroup, row, textInput } from "../src/components/components.ts";

const echo = slash({
    name: "echo",
    description: "Echoes your message",
    options: {
        text: option.string("What to echo", { required: true, max_length: 500 }),
        private: option.boolean("Only you can see it"),
    },
}, (i, { text, private: hidden }) => i.reply({ content: text, ephemeral: hidden }));

const fruits = ["apple", "apricot", "banana", "blueberry", "cherry", "grape", "lemon", "mango", "orange", "pear"];

const roll = slash({
    name: "roll",
    description: "Rolls dice",
    options: {
        sides: option.integer("Sides per die", { required: true, choices: [4, 6, 8, 12, 20] }),
        count: option.integer("Number of dice", { min_value: 1, max_value: 10 }),
    },
}, (i, { sides, count = 1 }) => {
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    return i.reply(`🎲 ${rolls.join(" + ")}${count > 1 ? ` = **${rolls.reduce((a, b) => a + b, 0)}**` : ""}`);
});

const fruit = slash({
    name: "fruit",
    description: "Pick a fruit (autocomplete demo)",
    options: {
        name: option.string("Start typing", {
            required: true,
            autocomplete: (_i, value) => fruits.filter((f) => f.startsWith(value.toLowerCase())),
        }),
    },
}, (i, { name }) => i.reply(`You picked **${name}** 🍎`));

const feedback = slash(
    { name: "feedback", description: "Opens a feedback form" },
    (i) =>
        i.showModal(modal("feedback", "Feedback", [
            label("How was it?", radioGroup("rating", ["Great", "Okay", "Bad"], { required: true })),
            label("What do you think?", textInput("text", { style: "paragraph", required: false })),
        ])),
);

const poll = slash(
    { name: "poll", description: "A tiny button poll" },
    (i) =>
        i.reply({
            content: "Tabs or spaces?",
            components: [row(button.primary("vote:tabs", "Tabs"), button.primary("vote:spaces", "Spaces"))],
        }),
);

const settings = slash({
    name: "settings",
    description: "Subcommand demo",
    subcommands: {
        show: subcommand(
            { description: "Show settings" },
            (i) => i.reply({ content: "Nothing to show yet.", ephemeral: true }),
        ),
    },
    groups: {
        greeting: {
            description: "Greeting settings",
            subcommands: {
                set: subcommand(
                    {
                        description: "Set the greeting",
                        options: { text: option.string("Greeting", { required: true }) },
                    },
                    (i, { text }) => i.reply({ content: `Greeting would be set to: ${text}`, ephemeral: true }),
                ),
            },
        },
    },
});

const userInfo = userCommand({ name: "User info" }, (i, { user, member }) =>
    i.reply({
        content: `**${user.global_name ?? user.username}** (<@${user.id}>)\nJoined: ${member?.joined_at ?? "n/a"}`,
        ephemeral: true,
    }));

const quote = messageCommand(
    { name: "Quote" },
    (i, message) => i.reply(`> ${message.content || "*(no text)*"}\n— <@${message.author.id}>`),
);

/** The shared router. Bots can add their own commands with `router.add(...)`. */
export const router = new CommandRouter([echo, roll, fruit, feedback, poll, settings, userInfo, quote])
    .component("vote", (i, [choice]) => i.reply({ content: `You voted **${choice}**.`, ephemeral: true }))
    .modal("feedback", (i) => {
        const { rating, text } = i.modalValues;
        return i.reply({ content: `Thanks! Rating: ${rating}. ${text ? `You wrote: ${text}` : ""}`, ephemeral: true });
    });
