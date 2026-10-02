import { MessageFlags } from "discord-api-types/v10";
import type { RawFile, RequestOptions } from "../rest/rest.ts";

/** Options accepted by write endpoints that support an audit log reason. */
export interface ReasonOptions {
    /** Audit log reason. */
    reason?: string;
}

/**
 * A message payload: a plain string, or a JSON body plus optional files.
 * `T` is the endpoint's JSON body type from discord-api-types.
 */
export type MessagePayload<T> = string | (T & { files?: RawFile[] });

/** Converts a {@link MessagePayload} into request options (body + files), filling in `attachments` for files. */
export function messageRequest<T extends object>(payload: MessagePayload<T>): Pick<RequestOptions, "body" | "files"> {
    if (typeof payload === "string") return { body: { content: payload } };
    const { files, ...body } = payload as { files?: RawFile[]; attachments?: unknown[] };
    if (files?.length && !body.attachments) {
        body.attachments = files.map((f, i) => ({ id: i, filename: f.name }));
    }
    return { body, files };
}

/** Adds the ephemeral flag to a flags value. */
export function withEphemeral(flags: number | undefined): number {
    return (flags ?? 0) | MessageFlags.Ephemeral;
}

/**
 * Encodes an emoji for reaction routes. Accepts a unicode emoji (`"👍"`), `"name:id"`,
 * or a custom emoji mention (`"<:name:id>"` / `"<a:name:id>"`).
 */
export function encodeEmoji(emoji: string): string {
    const mention = /^<a?:(\w+):(\d+)>$/.exec(emoji);
    return encodeURIComponent(mention ? `${mention[1]}:${mention[2]}` : emoji);
}

/** Casts a discord-api-types query object to the shape `RestClient` accepts. */
export function query(q: object | undefined): RequestOptions["query"] {
    return q as RequestOptions["query"];
}
