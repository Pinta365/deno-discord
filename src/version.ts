import denoJson from "../deno.json" with { type: "json" };

/** Library version (from deno.json), used in the User-Agent and gateway identify. */
export const VERSION: string = denoJson.version;
