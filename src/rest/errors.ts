/** Thrown when Discord responds to a REST request with a non-2xx status. */
export class DiscordAPIError extends Error {
    /** HTTP status code. */
    readonly status: number;
    /** Discord JSON error code, if the body contained one. See https://discord.com/developers/docs/topics/opcodes-and-status-codes#json */
    readonly code: number | undefined;
    /** Field-level validation errors, if any. */
    readonly errors: unknown;
    /** HTTP method of the failed request. */
    readonly method: string;
    /** Path of the failed request, relative to the API base, with webhook/interaction tokens redacted. */
    readonly path: string;
    /** The raw response body (parsed JSON or text). */
    readonly body: unknown;

    /** Creates an error from a failed response. */
    constructor(status: number, method: string, path: string, body: unknown) {
        const json = typeof body === "object" && body !== null ? body as Record<string, unknown> : undefined;
        const message = typeof json?.message === "string" ? json.message : String(body ?? "Unknown error");
        super(`${method} ${path} failed with ${status}: ${message}`);
        this.name = "DiscordAPIError";
        this.status = status;
        this.code = typeof json?.code === "number" ? json.code : undefined;
        this.errors = json?.errors;
        this.method = method;
        this.path = path;
        this.body = body;
    }
}
