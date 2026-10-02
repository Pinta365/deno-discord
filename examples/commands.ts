// Shared command definitions for the examples.
import { ApplicationCommandOptionType, type RESTPutAPIApplicationGuildCommandsJSONBody } from "../src/types.ts";

export const commands: RESTPutAPIApplicationGuildCommandsJSONBody = [
    { name: "ping", description: "Replies with Pong and the gateway latency" },
    {
        name: "echo",
        description: "Echoes your message",
        options: [
            { name: "text", description: "What to echo", type: ApplicationCommandOptionType.String, required: true },
            { name: "private", description: "Only you can see it", type: ApplicationCommandOptionType.Boolean },
        ],
    },
    { name: "feedback", description: "Opens a feedback form" },
];
