# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## Project

`@pinta365/discordbot` is a small Discord library for Deno, published to JSR. It covers:

- **Gateway bots**: `Client` (src/client.ts) manages one or more `Shard`s (src/gateway/shard.ts).
- **HTTP interactions**: `createInteractionHandler` (src/interactions/http.ts), a Fetch API `Request -> Response`
  handler.
- **REST**: `RestClient` (src/rest/rest.ts), rate-limited, with retries and multipart uploads.
- **API** (src/api/): typed convenience wrappers per resource (`client.api.channels`, etc.). Follow the `ChannelsAPI`
  pattern: `Routes.*`, discord-api-types `REST*` types, `ReasonOptions`, `MessagePayload`.
- **Cache** (src/cache/): opt-in, fed by `Cache.handle(payload)` from the client. Guilds, channels, roles, the bot's own
  member, and optional bounded messages. No general member cache by design.
- **Interactions**: `Interaction` (src/interactions/interaction.ts) wraps both gateway and HTTP interactions.

## Rules

- **Types come from `discord-api-types/v10`.** Don't hand-write Discord payload types; import them (re-exported via
  `src/types.ts` as `@pinta365/discordbot/types`). Use `Routes` for endpoint paths.
- Deno only for now; Deno APIs are fine. No Node-only dependencies except `node:` built-ins.
- Every exported symbol needs JSDoc and explicit types (JSR "slow types" rules). Check with `deno publish --dry-run`.
- Keep the public API small. Export new things from `mod.ts` deliberately.
- Formatting: `deno fmt` (4 spaces, 120 columns).
- Live smoke tests live in `tests/live/smoke.ts` (not named `_test.ts`, so plain `deno test` skips them).
- Tests live in `tests/`, use `@std/assert`, and never hit the network: inject `fetch` (`RestOptions.fetch`) and
  `WebSocket` (`ShardOptions.WebSocket`).
- The version lives only in `deno.json`; `src/version.ts` imports it. Bump it there.
- Don't commit; the maintainer handles git.
- `dev/` is a gitignored scratch area (notes, audits, throwaway scripts). Put temporary files there, not in the repo
  root.

## Commands

```sh
deno task ci          # fmt check + lint + type check + tests
deno task test
deno task test:live   # real Discord, needs .env; never in CI
deno publish --dry-run
```

Examples in `examples/` need a `.env` with `DISCORD_TOKEN`, and optionally `DISCORD_GUILD_ID` / `DISCORD_PUBLIC_KEY`,
run with `deno run --env-file --allow-env --allow-net examples/<file>.ts`.
