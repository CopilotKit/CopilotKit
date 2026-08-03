# Optional live E2E harness

Only worth running **after** a real human mention has been answered. If the
managed round trip does not work, the harness will not tell you why — it will just
fail in a more complicated way.

`examples/OpenTag` ships an API-first harness that posts real messages to a Slack
test channel, polls for replies while they stream, and writes a JSON report to
`e2e/results/`. It covers mentions, threads, streaming text, rich blocks,
follow-up turns, and interruptions.

## Why this phase is allowed to hold Slack tokens

This is the **one** exception to "Slack tokens never go in `.env`", and the reason
is that the harness is not the Channel — it is a **test client** driving the Slack
Web API directly, in order to act like a human user. Intelligence still owns the
Channel's own Slack attachment. These are test-harness credentials, not runtime
configuration.

## Configure

The developer adds these to the root `.env` themselves:

| Variable | What it is | Why the harness needs it |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | `xoxb-…` | Read channel history and thread replies |
| `SLACK_USER_TOKEN` | `xoxp-…` | Post **as a real user**, so Slack emits a genuine user event |
| `BOT_USER_ID` | `U…` | Identify the bot in replies |
| `E2E_CHANNEL` | `C…` | The test channel id |

The user token is the one to be deliberate about: it acts as the developer in
their workspace. It must be obtained through their approved app-management flow
and typed in by them. Never ask for it, never read its value, never suggest a
workaround for getting one.

**The Channel wizard's manifest declares no user scopes**, so a managed app has no
`xoxp-` token to collect. Running this harness therefore means adding a
`chat:write` **user** scope to the app and reinstalling — which rotates the bot
token and requires re-entering it in the adapter. Say that cost out loud before
starting, and treat it as a deliberate, separately-approved change rather than a
step of the main workflow. If the developer does not want to touch the working
app's scopes, that is a good reason to skip this phase entirely.

The starter states its own boundary explicitly: the repository intentionally
contains no browser automation that edits the manifest, reinstalls the app, or
extracts tokens. Respect that — do not add any.

## Run

Start the agent and the runtime, confirm the Channel is `online`, then:

```bash
pnpm e2e
```

A subset, by case-name substring:

```bash
CASE_FILTER='A1' pnpm e2e
```

Cases live in `e2e/cases.ts`; the entrypoint is `e2e/run.ts` and the Slack API
helpers are in `e2e/slack-api.ts`. Read `e2e/README.md` before running — it is the
authority on the harness's current requirements.

## Interpreting failures

The harness exercises the **whole** path, so a failure is not necessarily a
harness problem. Separate the layers before concluding anything:

| Symptom | Likely layer |
| --- | --- |
| No reply at all to any case | The Channel is not `online`, or the bot is not in `E2E_CHANNEL`. Not a harness bug. |
| Auth errors from the Slack API | A token is wrong, expired, or from a different app than the one installed in that workspace. |
| Replies arrive but assertions fail on content | The agent or the Channel's rendering — the delivery path is fine. |
| Some cases pass, some time out inconsistently | Suspect a second consumer racing for deliveries, an inbound dedup drop, or a shared agent instance serializing unrelated conversations. See `troubleshooting.md`. |

## Scope limits

- Slack only. There is no Teams live harness in the starter.
- Do not extend the harness to search the workspace, enumerate channels, or manage
  the Slack app. Its remit is one test channel it is told about.
- Do not treat a green harness run as a substitute for the human round trip. It is
  a regression net, not the acceptance criterion.
