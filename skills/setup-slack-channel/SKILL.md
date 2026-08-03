---
name: setup-slack-channel
description: Use for the PROVIDER half of getting a locally running CopilotKit Channels agent to answer in Slack, when no Slack app exists yet — setting up a Channels bot in Slack for the first time, creating the Slack app and its tokens, attaching it to a managed Intelligence Channel, or when a Channel reports setup_required, sits at "Waiting for runtime", the Channel is Online but a Slack mention gets no reply, or a Slack app was built with Socket Mode instead of an Intelligence Request URL. If the Slack app and Channel already exist and the question is about declaring or customising the Channel in code, use the copilotkit-channels skill instead.
version: 1.0.0
---

# Set up a Slack Channel for a local Channels agent

Take a developer from a code checkout to a working local Slack agent. **Five
separate systems** have to line up, and they are owned by four different parties:

| System                                                | Who owns it                   | Where you work on it                     |
| ----------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Slack workspace                                       | Workspace owner / app manager | Slack, in a browser                      |
| Slack app + its tokens                                | The developer                 | api.slack.com, in a browser              |
| Intelligence project, API key, Channel, Slack adapter | The developer                 | The Intelligence dashboard, in a browser |
| Local Channels runtime                                | The developer                 | This repo, in the shell                  |
| AG-UI agent backend                                   | The developer                 | This repo, in the shell                  |

## How delivery actually works — two legs, two mechanisms

Getting this wrong is the most expensive mistake available here, because a
misconfigured Slack app installs cleanly and answers nothing.

| Leg                             | Mechanism                                                                                                                                        | What authenticates it                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **Slack → Intelligence**        | Slack posts events over **HTTPS** to an Intelligence-hosted Request URL: `https://intelligence.copilotkit.ai/api/channels/adapters/slack/events` | The app's **signing secret**, held by Intelligence |
| **Intelligence → your runtime** | Your runtime dials **out** to the realtime gateway over a websocket                                                                              | `INTELLIGENCE_API_KEY`                             |

Two consequences:

- **No tunnel and no public URL of your own is needed** — but not because of Socket
  Mode. It is because _Intelligence_ owns the public URL, and because the second
  leg is outbound from your machine.
- **Socket Mode is off, and there is no `xapp-` app-level token in this workflow at
  all.** A managed Slack app needs `socket_mode_enabled: false` and a
  `request_url`. If you create the app with Socket Mode on and no Request URL, no
  event ever reaches Intelligence.

The Slack adapter form in Intelligence therefore asks for exactly two values: the
**bot token** (`xoxb-`) and the **signing secret**. Nothing else.

Most of this workflow happens in a **browser**, not a shell. A CLI may help with
local concerns like selecting a project or writing runtime configuration, but
**creating a Channel, attaching a Slack adapter, issuing an API key, and reading
Channel status exist only in the Intelligence browser experience.** Never imply a
command can complete a step that is browser-only, and never invent a command name
to fill the gap — if you are unsure whether a CLI covers something, check its
`--help` rather than guessing.

## Done means three things, all verified

Do not report success until **all three** hold. Any one alone is a false positive.

1. **The Slack app is installed** in a workspace, and the bot is a member of the
   channel you will test in.
2. **The managed Channel reports `online`** — from `controls.status()` in the
   process, or Online in the dashboard. Not "the runtime started."
3. **A real human mention got a real reply** in Slack.

Gate 2 is where agents fail. `await controls.ready()` resolves on
`setup_required` too — that state is documented as "a valid degraded state, not
a failure." A runtime with **no Slack connection at all** starts cleanly, prints
its listening line, returns HTTP 200 on `/api/copilotkit/info`, and answers
nothing. `/api/copilotkit/info` reports license and runtime info, **not** channel
state, so a 200 there is not evidence of anything Slack-related.

The SDK behaviors asserted here were verified against the currently published
`@copilotkit/channels@0.6.0` and `@copilotkit/runtime@1.65.0`. A starter may pin
something older or newer, and this API is moving fast. If a claim here
contradicts what you observe, **trust the installed package** and re-read it —
do not argue with the runtime.

## Scope — read before planning

**In scope:** production CopilotKit Intelligence; a managed Channel; a dedicated
Slack app created from a manifest; a local runtime and agent.

**Out of scope in v1. These are hard limits, not defaults to weigh:**

- **Do not switch to a direct Slack adapter** (`adapters: [slack({ botToken,
appToken })]`). Not as a fallback, not to save time, not because the dashboard
  is confusing. See the prohibitions below — this is the single most common way
  this workflow goes wrong.
- **Do not reuse, reinstall, or modify a Slack app that is already installed and
  in use.** Create a dedicated one.
- Do not deploy anything (Railway or otherwise).
- Do not target internal or dev Intelligence environments.
- Do not enumerate the Slack workspace, search channels, or request scopes beyond
  the manifest.

## Phase 0 — Establish the route and the contract

**First, check whether Phases 1–2 are already done for you.** Some organizations
run a dedicated **dev bot** alongside their production one and hand developers a
ready-made environment file — the Slack app, the Channel, and the adapter already
exist, and the dev bot comes online only while someone runs it locally.

Ask: _is there an existing dev bot and a provided config for this, or am I
setting one up from scratch?_

If a config is provided, **skip Phases 1 and 2 entirely**: put the provided
values in `.env` (the developer retrieves them from their team's secret-sharing
channel — never ask them to paste the contents here), install, and run. Do not
create a new Slack app, and do not create a Channel. Phases 3–5 still apply, and
the three success gates are unchanged.

Otherwise, pick the starter, in this order:

1. **An OpenTag checkout** — the developer's cwd is one, or they name one. This is
   the most likely path. Detect it: a `slack-app-manifest.yaml` plus
   `app/channel.tsx` at the root.
2. **`examples/OpenTag` in this repo**, if present. It is a submodule, so a plain
   clone leaves it empty:

   ```bash
   git submodule update --init examples/OpenTag
   ```

3. **Neither** → have the developer clone it, and work from there:

   ```bash
   git clone https://github.com/CopilotKit/OpenTag.git
   ```

Whichever you land on, treat that checkout as the source of truth. Do not carry
facts between checkouts — versions, env var names, and registered handlers differ
between OpenTag revisions, which is why the next step reads them rather than
assuming them.

Then read the app's **own** environment contract instead of assuming variable
names. They differ between apps, and so does the vocabulary for the _same_
concept: OpenTag uses `INTELLIGENCE_CHANNEL_NAME`, the Channels SDK README's
quickstart calls it `CHANNEL_CODE`, and it is also referred to as the Channel's
**slug**. All of them mean the `name` passed to `createChannel()`, which must
match the Channel in the dashboard character for character. Read the app's
parser; do not guess which word this codebase uses.

```bash
cat .env.example
grep -rn "process.env" app/env.ts server.ts 2>/dev/null
grep -n "onMention\|onMessage\|onCommand\|createChannel(" app/channel.tsx
```

Record, and state back to the developer: the exact env var names, the Channel
name the code will declare, and which handlers are registered.

**Know what the managed adapter does not deliver.** The wizard's generated
manifest declares **no `slash_commands`** and sets `interactivity.is_enabled:
false`. As shipped, a managed Slack Channel receives mentions, messages and
reactions — **not slash commands and not interactive component payloads**. So an
app registering `onCommand`, `onModalSubmit`, or button/select components will
compile, start, report `online`, and never fire those handlers on the managed
path. OpenTag registers `onModalSubmit` and ships four commands; none of them work
here. Say this up front rather than letting the developer debug it, and do **not**
invent a Request URL for commands or interactivity to fill the gap.

That last one decides what "working" even looks like. Turn routing is not
symmetric: a **mentioned** turn goes to `onMention` if registered and otherwise
falls back to `onMessage`, while a **non-mentioned** turn goes only to
`onMessage`. So an app registering just `onMention` — which is what OpenTag does
— answers channel mentions, and may silently do nothing for any turn Intelligence
does not flag as a mention. **Verify with a channel mention first**; it is the
path every starter registers. Details in `references/troubleshooting.md`.

Confirm before continuing: production Intelligence, a dedicated Slack app, and a
workspace where they can install it.

## Phase 1 — Workspace, and start the Channel wizard to get the manifest

**The Channel comes first, because the Channel generates the Slack app's
manifest.** Do not hand-write one, and do not use the starter's
`slack-app-manifest.yaml` — see the prohibition below.

1. No usable workspace → create a free one, or a Slack Developer Program sandbox.
   Never test in a workspace where an unapproved bot would be disruptive.
2. In the Intelligence dashboard, start **Create a channel**. Enter a **Display
   name**; the wizard derives the **Code** from it — lowercase kebab-case, and the
   Code is what `createChannel({ name })` must declare. Select **Slack**.
3. Advance to **Setup**. That step contains a generated manifest ("Copy manifest" /
   "View manifest YAML") already pointed at the right Request URL, plus the two
   credential fields you will fill in Phase 3. **Nothing is saved until you
   finish**, so leave this tab open.

Read the wizard's own warning before you install anything: _Slack bot names and
slash commands are workspace-wide. If either generated name is already in use,
choose a more specific Channel display name before installing._ A collision here
blocks the install, so resolve it by renaming the Channel, not the manifest.

Full detail in `references/intelligence-channel.md`.

## Phase 2 — Create and install the Slack app from that manifest

Full detail in `references/slack-workspace-and-app.md`. The shape:

1. Create a **new** app **from the manifest the wizard generated**. Change the
   display name so it is obviously a dev app.
2. Install it. **Installing is the gated step** — by default only Workspace Owners
   review app requests, and they may appoint app managers to do so too. Creating
   the app is normally not gated, so create it while any install request is
   pending rather than waiting.
3. Collect two values: the `xoxb-` **bot token** (OAuth & Permissions) and the
   **signing secret** (Basic Information → App Credentials). They go to
   Intelligence — never into this repo. There is **no `xapp-` token** in this
   workflow.
4. Invite the bot to a test channel: `/invite @YourBot`.

## Phase 3 — Finish the Channel: adapter credentials and API key

Back in the open wizard tab. Browser work, in the developer's own session. Four
things must line up: Channel Code matches what the code declares, the Slack
adapter reports connected, Channel and API key in the **same project**, endpoints
left at their production defaults.

The developer types the bot token and signing secret into the **Setup** step
themselves, then Review → create. Then issue a project-scoped API key and have
them paste it into `.env`.

Because these are consequential mutations in a live dashboard: **read the page
before you act, describe what you are about to change, and get explicit
confirmation.** Never guess at a control and click it.

## Phase 4 — Configure and start the runtime

Full detail in `references/local-runtime.md`.

The developer puts `INTELLIGENCE_API_KEY` into `.env` themselves. Verify by
presence, never by printing. Then start the agent backend, then the runtime — and
start it with logs turned up, because the runtime's logger defaults to `error`
while every Channel lifecycle breadcrumb is emitted at `warn`:

```bash
LOG_LEVEL=debug pnpm runtime
```

`channel "<name>" requires setup` in that output means Phase 2 is incomplete. It
is the single highest-value line in this entire workflow, and at the default log
level it is written and discarded.

## Phase 5 — Verify, in order

1. `controls.status()` → `overall: "online"`. If the app does not already assert
   this, add the assertion — `examples/OpenTag`'s `server.ts` calls `ready()` and
   never checks status, which is exactly how a broken setup looks healthy.
2. The dashboard shows the Channel Online while the process runs. Its **Runtime**
   panel should read _Connected_. Ignore the **Agent run** column — it reads `—`
   even after a turn completes successfully, so it is not a health signal.
3. **The developer** sends a real mention from their own Slack account and reports
   the reply.

Step 3 is theirs. Do not post to Slack on their behalf, and do not substitute
reading the workspace with a Slack tool for a genuine round trip. If a mention
produces nothing, go to `references/troubleshooting.md` — diagnose by layer, do
not start changing configuration.

## Phase 6 — Optional live E2E

Only after a real mention works. `references/optional-e2e.md`. This is the one
place Slack tokens legitimately enter `.env`, because the harness drives the
Slack API directly as a test client.

## Never do these

**Never switch to a direct Slack adapter to get unblocked.** It moves platform
credentials into the app, abandons managed delivery's retries/dedup/ordering,
still requires an Intelligence key, and means you validated a different
architecture than the one the developer asked about. If the managed path is
blocked, say it is blocked and say why.

**Never create the Slack app from the starter's own `slack-app-manifest.yaml`.**
OpenTag's manifest sets `socket_mode_enabled: true` and declares **no
`request_url`**, which is the shape for a _direct_ adapter, not a managed Channel.
An app created from it installs cleanly, shows green in Slack, and delivers
nothing to Intelligence forever. Use the manifest the Channel wizard generates.
The same applies to `assets/slack-app-manifest.yaml` in this skill — it is kept
only as a reference for the direct-adapter shape.

**Never reuse a production or shared Slack app.** One Slack app has exactly one
event-subscription Request URL. Pointing an existing app at your Channel's URL
**redirects that app's entire event stream away from whatever was serving it** —
you do not observe production traffic, you hijack it, and real users get answered
by an in-progress agent on a laptop. Slack offers no way to scope delivery to one
channel or one user. Pasting a manifest over an installed app also forces
reinstallation and rotates its tokens, breaking every existing consumer.

**Never ask for a secret in chat, and never print one.** Full ownership table and
handling rules in `references/secrets-and-credentials.md`.

**Never use the runtime API key to probe Intelligence HTTP endpoints.** It is a
project-scoped activation key, not a dashboard session; dashboard endpoints
reject it, and a response body could carry platform tokens.

**Never mutate the environment to make progress feel faster.** No `pnpm install`,
no killing processes you did not start, no editing `.env` for the developer,
without naming the change and getting a yes.

## Rationalizations

| Thought                                                                     | Reality                                                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "They're on a deadline, the direct adapter is faster"                       | You would be validating a different architecture and handing them credentials in the wrong place. Deadline pressure is when scope discipline matters most.     |
| "The dashboard is confusing, code is more reliable"                         | The confusion is the developer's actual problem. Solving it in code hides it.                                                                                  |
| "The prod Slack app is already installed, so reusing it saves the approval" | Repointing its Request URL hijacks that app's whole event stream. The approval exists because installs affect other people.                                    |
| "It's just for testing / just for a minute"                                 | An app has one events URL. While yours is set, production is not receiving its events at all.                                                                  |
| "The starter ships a manifest, so I'll create the app from that"            | It sets `socket_mode_enabled: true` with no `request_url` — the direct-adapter shape. The app will install green and never deliver. Use the wizard's manifest. |
| "I need to generate an `xapp-` app-level token"                             | There is no `xapp-` token in this workflow and nowhere to put one. The adapter takes a bot token and a signing secret.                                         |
| "The runtime started and `/info` returns 200, so we're connected"           | `ready()` resolves on `setup_required` and `/info` reports license state. Neither says anything about Slack.                                                   |
| "`ready()` resolved without throwing, so the Channel is online"             | It resolves on `setup_required` by design. Read `status()`.                                                                                                    |
| "I'll check the Channel state with the API key"                             | Dashboard endpoints reject a project key. Use `status()` or the dashboard.                                                                                     |
| "Let me just read `.env` to see what's configured"                          | Read `.env.example` for names; check `.env` only for presence, and never quote a value.                                                                        |
| "I'll send the test mention myself to save a round trip"                    | The success criterion is a real human mention. Posting for them proves less and acts on their behalf in their workspace.                                       |
| "No reply — let me try changing the config"                                 | Diagnose by layer first. `LOG_LEVEL=debug` names the failure in one line.                                                                                      |

## Red flags — stop

- You are about to type `adapters: [slack(` or add `SLACK_BOT_TOKEN` to `.env`
  for anything other than the Phase 6 harness.
- You are about to create the Slack app from the starter's manifest, or from any
  manifest with `socket_mode_enabled: true` and no `request_url`.
- You are about to look for an app-level token, `connections:write`, or a Socket
  Mode toggle. None of them belong to a managed Channel.
- You are about to open or screenshot the app's **Install App** page. It renders
  the bot token in plain text; reading it captures a live credential.
- You are about to say "connected", "working", or "done" without all three gates.
- You are about to ask the developer to paste a token, or you are about to echo one.
- You are about to click a dashboard control you have not read.
- You are about to `pnpm install`, kill a process, or edit `.env` unasked.
- You have spent many tool calls deriving how managed Channels work. Stop — it is
  in this skill and its references.

## References

Read the reference for the phase you are actually in — not all of them up front.
Each is self-contained, and reading six files before saying anything to the
developer is how this workflow gets slow.

| File                                    | Read it when                                                              |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `references/intelligence-channel.md`    | Phases 1 and 3 — wizard, Code, adapter, project, key                      |
| `references/slack-workspace-and-app.md` | Phase 2 — workspace, install, bot token, signing secret                   |
| `references/secrets-and-credentials.md` | Any time a credential is in play                                          |
| `references/local-runtime.md`           | Phase 4 — env, agent, runtime, startup, ports                             |
| `references/optional-e2e.md`            | Phase 6 — the live Slack harness                                          |
| `references/troubleshooting.md`         | Anything fails, or a mention gets no reply                                |
| `assets/slack-app-manifest.yaml`        | Reference only — the **direct-adapter** shape. Not for a managed Channel. |
