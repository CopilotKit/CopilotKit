# `e2e/telegram-*` — live end-to-end test harness for the Telegram bot

True end-to-end coverage: send real messages to a real Telegram chat, poll
the bot's reply via the Bot API, and verify what landed.

> **Why this exists.** Unit tests (under `app/**/__tests__/`) lock in internal
> module contracts. They don't catch issues that only surface end-to-end: an
> unbalanced code fence leaking through, a Markdown→HTML translation that
> looks correct in tests but renders wrong in Telegram, or an agentic reply
> that truncates when the LLM hits a tool call boundary.

## What's in here

```
e2e/
├── TELEGRAM-README.md   this
├── telegram-cases.ts    catalog of test cases (expand liberally)
├── telegram-api.ts      Telegram Bot API helpers (send, poll, balance check)
└── telegram-run.ts      harness entrypoint — sends prompts, polls replies
```

Results land under `e2e/results/<timestamp>/report.json` (shared with the
Slack harness).

## Approach chosen: (b) MANUAL-TRIGGER smoke with automated upgrade path

The Telegram Bot API does **not** allow impersonating a human user to send
messages. This creates a bootstrapping problem that Slack avoids via its
user-token (`xoxp-`) mechanism:

- A bot can call `sendMessage` as itself, but the CopilotKit bot's loop guard
  ignores messages from other bots to prevent infinite loops.
- MTProto-based user automation (TDLib, Telethon) requires a verified
  Telegram account, a registered API app (`api_id` + `api_hash`), a session
  file, and significant additional infrastructure.

Therefore the default flow is **manual-trigger**:

1. The harness prints the test prompt.
2. You open the Telegram chat with the bot and send that text.
3. The harness polls `getUpdates` on the bot token and validates the reply.

### Automated upgrade (approach a)

Set `TELEGRAM_SENDER_BOT_TOKEN` in `.env` to a second ("sender") bot token.
The test chat must be a **group or supergroup** with both the sender bot and
the main bot as members. In this mode the harness posts prompts
programmatically via the sender bot and the main bot replies to the group.

> Note on coverage: the manual-trigger flow does NOT reduce assertion
> coverage. All expectations (`finalContains`, `finalNotContains`,
> `balancedBrackets`, `minLength`, `perReplyChecks`) — plus the optional
> `followUp` second turn — are evaluated against the real bot reply. What it
> reduces is _automation_: you need to type (or paste) each prompt once.

## Prerequisites

| Variable                    | Required | Description                                       |
| --------------------------- | -------- | ------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Yes      | The main bot's token from BotFather               |
| `TELEGRAM_TEST_CHAT_ID`     | Yes      | Numeric chat ID of the test chat (DM or group)    |
| `TELEGRAM_SENDER_BOT_TOKEN` | No       | Second bot token for full automation (group mode) |

### Finding your `TELEGRAM_TEST_CHAT_ID`

- **DM with the bot:** Start a chat with the bot, then call
  `https://api.telegram.org/bot<TOKEN>/getUpdates` — the `chat.id` in your
  message is your user ID (a positive integer).
- **Group:** Add the bot to a group, send a message, call `getUpdates` — the
  `chat.id` is a negative integer.

## Running

```bash
# from examples/slack/

# Copy the example env and fill in the required vars:
cp .env.example .env   # edit TELEGRAM_BOT_TOKEN + TELEGRAM_TEST_CHAT_ID

# Run all cases (manual-trigger mode by default):
pnpm e2e:telegram

# Run a single case by name filter:
CASE_FILTER='C1' pnpm e2e:telegram
```

In manual-trigger mode the harness will pause before each case and print the
prompt to send. You have ~15 seconds to paste it into the Telegram chat before
the harness starts polling.

## How polling works

For each case the harness:

1. Calls `getUpdates` to drain any stale messages from the bot's queue.
2. (Automated) Sends the prompt via the sender bot, OR (manual) waits for the
   operator to send it.
3. Polls `getUpdates` on the main bot token every `sampleIntervalMs` until
   `maxWaitMs` elapses or the reply stabilises.
4. Runs expectations on the final reply text.
5. Writes `results/<timestamp>/report.json`.

### Streaming via message edits

The example bot uses chunked-edit mode (`editMessageText`) to stream replies:
it posts a `_thinking…_` placeholder and then edits it repeatedly as chunks
arrive from the LLM. To observe this, the harness subscribes to both
`message` and `edited_message` update types in `getUpdates` and tracks the
**latest text for each bot `message_id`**. This means `finalText` in
expectations reflects the last edit (the completed reply), not the initial
placeholder.

Mid-stream samples may still show intermediate edited texts between polls,
but the `balancedBrackets` check is applied only to the final stable text.

## Adding cases

Edit `telegram-cases.ts`. The bar is low — anything you'd want to _see_ working in
Telegram belongs in the catalog.
