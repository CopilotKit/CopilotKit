# `e2e/` — live end-to-end test harness

True end-to-end coverage for the Slack bridge: send real user messages
in a real Slack workspace, sample the bot's reply _while it's streaming_,
take screenshots in the middle of long streams, and verify what landed.

> **Why this exists.** Unit tests (under `src/__tests__/`) lock in the
> internal contracts of each module — they don't catch issues that only
> surface end-to-end: an open code fence leaking through the rest of the
> Slack message during streaming, a mrkdwn translation that _looks_ right
> in tests but renders weird in Slack's actual client, a Block Kit limit
> we forgot about, a Bolt event that doesn't fire under some setting.
>
> The catalog at `e2e/cases.ts` is the source of truth for what
> "feature-complete" means.

## What's in here

```
e2e/
├── README.md         this
├── cases.ts          catalog of test cases (technical axes; expand liberally)
├── slack-api.ts      Slack Web API helpers (history, thread replies, sampling)
├── run.ts            harness entrypoint — sends prompts, samples, screenshots
└── results/          per-run output: screenshots + JSON report
```

## Running

```bash
# from packages/slack/

# one-time: log into Slack once in the playwright browser profile.
# Subsequent runs reuse that profile.
pnpm exec playwright open --browser=chromium --user-data-dir=./e2e/.chrome-profile \
  https://app.slack.com/client/T05QFA4BW9X/C0B49MEJ1HQ

# then:
pnpm e2e
```

The runner expects `.env` to already contain `SLACK_BOT_TOKEN` (used for
polling the channel history while the bot streams). Sending the user
message happens through the playwright-driven Slack UI using Atai's
session cookies from the persistent profile.

## How sampling works

For each case the harness:

1. Sends the prompt via the Slack UI (or `/agent` slash command).
2. Polls `conversations.replies` (or `.history` for DMs / flat replies)
   every `sampleIntervalMs` until `maxWaitMs` elapses.
3. At each sample, records:
   - elapsed time
   - bot's reply text snapshot
   - bracket-balance check (`isBalanced(text)`)
4. At each `screenshots[i]` offset (ms after send), takes a screenshot of
   the Slack thread pane via playwright.
5. After the run, writes `results/<timestamp>/report.json` and the screenshots.

## What this catches that unit tests don't

- Open code fences leaking through the rest of the Slack message
- Slack's `chat.update` rate limits creating visible "jumps"
- mrkdwn rendering differences vs. our translator's expectations
- The bot's actual streaming cadence with the model
- Thread vs DM rendering differences
- Real concurrency from multiple users in the channel
- Mid-stream cancellation / kill behaviour

## Adding cases

Edit `cases.ts`. The bar is low — anything you'd want to _see_ working in
Slack belongs in the catalog. Don't be afraid of duplication with
unit tests; the unit test proves the code is internally correct, the E2E
proves Slack actually renders it that way.

## Limitations (current)

- Sending the user message still relies on UI automation (no user
  token), so a one-time signin in the persistent profile is required.
- A future enhancement: a long-lived user OAuth token would let us skip
  the browser entirely for the _send_ step (screenshots still need the
  browser, but sampling already uses pure API).
