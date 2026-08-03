# Secrets and credentials

Six different values are in play and they have **four different owners**. Most
setup failures — and every setup leak — come from putting a value somewhere its
owner never intended.

## Who owns what

| Value | Shape | Issued by | Its one correct home | Never put it |
| --- | --- | --- | --- | --- |
| Slack **bot** token | `xoxb-…` | The Slack app, on install | The Slack adapter form in Intelligence, typed by the developer | In `.env`, in the repo, in chat |
| Slack **signing secret** | 32-char hex | The Slack app, Basic Information → App Credentials | The Slack adapter form in Intelligence, typed by the developer | In `.env`, in the repo, in chat |
| Intelligence **runtime API key** | `cpk-…` | The Intelligence project (API Keys) | The app's `.env` as `INTELLIGENCE_API_KEY` | In the repo, in chat |
| **OpenAI** key | `sk-…` | platform.openai.com | The agent's env as `OPENAI_API_KEY` | In the repo, in chat |
| Slack **user** token | `xoxp-…` | The Slack app, user scopes | `.env`, **only** for the optional E2E harness | Anywhere else |
| `BOT_USER_ID`, `E2E_CHANNEL` | `U…`, `C…` | Slack workspace | `.env` for the E2E harness | — Not secrets |

The load-bearing split: **Slack credentials go to Intelligence, not to your app.**
A managed Channel holds no platform credentials. If you find yourself adding
`SLACK_BOT_TOKEN` to the app's `.env` to make a managed Channel work, you have
taken a wrong turn — see `intelligence-channel.md`.

There is **no Slack app-level (`xapp-`) token in this workflow.** Managed delivery
reaches Intelligence over HTTPS, not Socket Mode, so the pair Intelligence needs
is *bot token + signing secret*. If you are hunting for `connections:write`, stop
and re-read `SKILL.md`.

## Rules for the agent

**Never ask the developer to paste a secret into the conversation.** Not to
"check the format", not to "verify it's the right one", not because they offered.
A developer offering tokens is common and is not permission — decline and
redirect to the correct destination:

> I don't need those and shouldn't have them. The bot token and the signing
> secret go straight into the Slack adapter form in Intelligence, entered by
> you. I'll tell you exactly which field each one goes in.

**Some pages leak by simply being looked at.** The Slack app's **Install App**
page (`/apps/<id>/install-on-team`) renders the bot token in **plain text**, not
masked. A screenshot, an accessibility-tree read, or a page-text extraction of
that page captures a live credential into the transcript. Treat it as
off-limits: do not open it to "check" anything. When you must confirm a token
exists, test for its *shape* and report a boolean — never the value:

```js
// Returns true/false. Never returns token material.
/xoxb-[A-Za-z0-9-]+/.test(document.body.innerText)
```

The Channel adapter form is safe by contrast: its fields are `type="password"`.
And if a token does reach the transcript, the app's **Reinstall** flow rotates
the bot token, which is the fastest real remediation — but say so out loud first.

**Never print, echo, `cat`, or `grep` a secret's value.** Check *presence*, never
content. This prints names and nothing else:

```bash
# Which required vars are set — values never leave the shell.
for v in INTELLIGENCE_API_KEY AGENT_URL OPENAI_API_KEY; do
  [ -n "${!v:-}" ] && echo "$v: set" || echo "$v: MISSING"
done
```

To inspect the app's config, read **`.env.example`** — it documents every
variable by name with no live values. Read `.env` itself only when you need to
know whether a variable is *set*, report only the variable names, and never
quote a value or a value fragment back to the developer or into a file.

**Never use the runtime API key to call Intelligence HTTP endpoints.** It is a
project-scoped key for gateway activation, not a dashboard session. Verified:
`GET /api/channels` with `Authorization: Bearer cpk-…` returns
`CLERK_TOKEN_INVALID`. Probing with it tells you nothing, spends a live
credential on an unrelated service, and risks a response body containing
platform tokens. Channel state comes from two places only: the dashboard in the
developer's browser, and `controls.status()` in the process.

**Never commit a secret.** Before writing any env file, confirm it is ignored:

```bash
git check-ignore -v .env
```

No output means `.env` is **not** ignored — stop and fix `.gitignore` before
writing anything into it.

**Let the developer type it.** When a value must land in a file, tell them the
file, the variable name, and the format, and have them add it themselves. Then
verify with a presence check. This costs one extra round trip and removes the
whole class of leak where a secret passes through the transcript.

## Rotation and blast radius

Say this plainly when it applies, because it changes how careful someone is:

- Pasting a manifest over an **installed** Slack app can reinstall it and rotate
  its tokens, breaking every consumer that holds the old ones.
- Regenerating an Intelligence API key invalidates the old one — any other
  runtime using it stops activating.
- Reinstalling a Slack app to add a scope issues a new bot token. The token
  already stored in Intelligence becomes stale and must be re-entered. **Order
  matters:** reinstall first, then copy the token into the adapter. Doing it the
  other way round stores a token that the reinstall immediately invalidates.
- Changing a Slack app's manifest changes its scopes, which requires a reinstall
  before the change takes effect. Slack shows a banner saying so; it is not
  optional.
- The signing secret is **not** rotated by a reinstall. Rotate it explicitly from
  Basic Information if it is ever exposed, then re-enter it in the adapter.

## If a secret does leak

If a token reaches the conversation, a log, or a commit, say so immediately and
plainly, and tell the developer to rotate it — Slack tokens from the app's
config page, the Intelligence key from API Keys. Do not quietly continue: a
leaked token in a transcript is a live credential. Do not attempt to scrub it
yourself as a substitute for rotation.
