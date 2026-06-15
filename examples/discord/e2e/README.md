# `e2e/` — live end-to-end test harness

True end-to-end coverage for the Discord bot: post real user messages in a
real Discord guild, sample the bot's reply _while it's streaming_, and verify
what landed — without a browser dependency.

> **Why this exists.** Unit tests (under `app/**/__tests__/`) lock in the
> internal contracts of each module — they don't catch issues that only
> surface end-to-end: a streaming edit that produces an unbalanced code fence
> mid-flight, a Components V2 message that renders incorrectly, a
> `confirm_write` HITL card that lands with the wrong button structure, or a
> thread-continuation that silently drops context. The catalog at
> `e2e/cases.ts` is the source of truth for what "feature-complete" means.

## What's in here

```
e2e/
├── README.md          this
├── cases.ts           catalog of test cases (technical axes; expand liberally)
├── discord-api.ts     Discord REST helpers (history, message polling, sampling)
├── run.ts             harness entrypoint — posts prompts, samples, reports
└── results/           per-run output: JSON report (created at runtime)
```

## CI guard — it never runs in CI unless you explicitly opt in

The harness exits **0 (clean pass)** immediately when `DISCORD_E2E` is not
set. This means `pnpm test`, `pnpm e2e` in CI, and any other runner that
doesn't export `DISCORD_E2E=1` will see an instant clean exit — no errors,
no output beyond the one-liner, no network traffic.

```
Discord e2e harness skipped (DISCORD_E2E not set). ...
```

Only export `DISCORD_E2E=1` when you're actually running against a live
Discord guild with the bot running.

## Required environment variables

Add these to `.env` (alongside the existing bot credentials) before running:

| Variable | Required | Description |
|---|---|---|
| `DISCORD_E2E` | **Yes (gate)** | Set to `1` to enable the harness. Without this, `pnpm e2e` is a no-op. |
| `DISCORD_BOT_TOKEN` | Yes | Bot token — already in `.env` for the live bot. |
| `DISCORD_APP_ID` | Yes | Application ID from Developer Portal → General Information. |
| `DISCORD_BOT_USER_ID` | Yes | The bot's user ID (find it in Developer Portal → Bot, or from `GET /users/@me`). |
| `DISCORD_TEST_GUILD_ID` | Yes | Snowflake ID of the throwaway test guild (right-click server → Copy Server ID). |
| `DISCORD_TEST_CHANNEL_ID` | Yes | Snowflake ID of the test channel inside that guild. |
| `DISCORD_TEST_USER_TOKEN` | Recommended | Token for a _second_ Discord account (user bot / alt). Messages sent from this token bypass the bot's own-message guard, giving accurate trigger delivery. Without it the harness falls back to the bot token and warns. |
| `DISCORD_INTERACTIONS_URL` | Optional | HTTP URL of the bot's registered Interactions Endpoint. Required for button-click simulation (E-hitl cases). Without it, click-simulation steps are skipped with a warning (they don't fail the run). |

## Setting up a throwaway test guild

1. Create a **new Discord server** ("test guild") — keep it private.
2. Invite the bot to that server using the OAuth2 URL Generator
   (scopes: `bot` + `applications.commands`; permissions: Send Messages,
   Read Message History, Use Slash Commands, Embed Links).
3. Create a dedicated `#e2e-test` text channel. Copy its channel ID
   (`DISCORD_TEST_CHANNEL_ID`).
4. Copy the server ID (`DISCORD_TEST_GUILD_ID`).
5. Set `DISCORD_GUILD_ID=<test-guild-id>` so the bot registers slash commands
   to this guild instantly (no 1-hour global propagation delay).

### Getting a test-user token (optional but recommended)

The cleanest approach is a **second Discord application with a user-bot
token**. Create a second app in the Developer Portal, add it to the test
guild as a bot, and set `DISCORD_TEST_USER_TOKEN` to that app's bot token.
This second bot acts as the "human" side — it sends the messages the first
bot is supposed to respond to, and since it has a different user ID, the
first bot's own-message guard won't suppress the trigger.

Alternatively, a self-bot (user account token) works for personal testing
but violates Discord's ToS for automated use; the second-bot approach above
is safer.

## Running

```bash
# Start the bot and runtime first (in separate terminals):
pnpm runtime      # CopilotKit runtime on :8200
pnpm dev          # Discord bot (tsx watch app/index.ts)

# Then run the harness from examples/discord/:
DISCORD_E2E=1 pnpm e2e
```

### Running a single case

```bash
DISCORD_E2E=1 CASE_FILTER='A1' pnpm e2e
```

The `CASE_FILTER` env var is a substring matched against case names. Useful
when iterating on a single case without waiting for the full suite.

## How sampling works

For each case the harness:

1. Records the ID of the most-recent channel message as an anchor.
2. Posts the prompt as the test user (or bot token fallback).
3. Polls `GET /channels/:id/messages?after=<anchor>` every
   `sampleIntervalMs` until `maxWaitMs` elapses or the reply has settled
   (no content-length change across 3 consecutive samples).
4. At each sample, fetches the message by ID via
   `GET /channels/:id/messages/:id` to get the latest edited content
   (Discord bots stream replies by PATCHing the same message).
5. Records elapsed time, content length, a 100-char preview, and a
   bracket-balance check.
6. Writes `results/<timestamp>/report.json` with all sample traces.

## What this catches that unit tests don't

- Unbalanced fenced code blocks mid-stream (auto-close not firing correctly)
- Discord's PATCH rate-limits creating visible "jumps"
- Markdown that looks fine in unit tests but renders oddly in Discord
- The actual streaming cadence with the model (not mocked)
- Thread-continuation context drops
- Components V2 / button structure regressions
- Interaction routing regressions (custom_id encoding in HITL buttons)

## Adding cases

Edit `cases.ts`. The bar is low — anything you'd want to _see_ working in
Discord belongs in the catalog. Use `BOT_MENTION` as a sentinel:

```ts
import { BOT_MENTION } from "./cases.js";

{
  name: "My new case",
  prompt: `${BOT_MENTION} do the thing`,
  expectations: { finalContains: ["expected phrase"] },
}
```

The runner substitutes `{{BOT_MENTION}}` with `<@BOT_USER_ID>` at runtime.

## Limitations

- **Button-click simulation** requires `DISCORD_INTERACTIONS_URL` and a bot
  that has an Interactions Endpoint URL configured. Gateway-only bots can't
  receive synthetic interactions via REST; set the endpoint URL in the
  Developer Portal to enable this.
- **Slash commands** cannot be fired programmatically via the REST API from
  a user token — Discord only delivers `/command` interactions through the
  Gateway. Those cases are currently marked as manual-only in `cases.ts`.
- **Streamed embeds** (Components V2 renders) are polled via content diff;
  the harness reads `components` arrays when present but can't assert on
  rendered visual output without a browser.
- A future improvement: expose `DISCORD_INTERACTIONS_URL` automatically
  when the bot is started in test mode with a known local port.
