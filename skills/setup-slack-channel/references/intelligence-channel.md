# Intelligence project, API key, and Channel

This phase is **entirely browser work, in the developer's own signed-in session**.
No command creates a project, a Channel, an API key, or a Slack adapter.

The dashboard is at **`https://intelligence.copilotkit.ai`** — the URL documented
in a comment in the starter's `.env.example`. Confirm it from the app you are
setting up rather than assuming. Note that `INTELLIGENCE_API_URL` is **not** in
OpenTag's `.env.example`; it exists only as a default constant in `app/env.ts`
(alongside `INTELLIGENCE_GATEWAY_WS_URL`), and both should be left unset.

## The wizard, and the labels it actually uses

There is **no published dashboard walkthrough** for managed Channels — the Slack
platform page in the public docs covers only the direct adapter. So confirm what
you see rather than inventing labels. As of dashboard `0.10.1`, **Create a
channel** is a three-step wizard:

| Step | What it contains |
| --- | --- |
| **Name & platforms** | **Display name** (free text) and **Code** (auto-derived, read-only unless you click Edit). Platform cards: Slack and Teams selectable; Google Chat, Discord, WhatsApp, Telegram, iMessage, SMS marked coming soon. |
| **Setup** | The generated Slack app manifest, plus **Bot token \*** and **Signing secret \*** (both `type="password"`), plus the `/invite @<code>` line. |
| **Review** | The runtime handoff snippet showing `createChannel({ name: '<code>' })`, and the **Create channel** button. |

**Nothing is saved until you finish.** If you navigate away mid-wizard you start
over, so do the Slack app work in a *second tab* and keep the wizard open.

**Code is the field that matters.** The dashboard describes it as "exactly what
`createChannel({ name })` declares," and enforces 3–64 chars, starting with a
lowercase letter, lowercase alphanumerics separated by single hyphens (`channels`
is reserved). It derives from the Display name, so `Jerel-Bot` becomes
`jerel-bot`. A friendly Display name with a kebab-case Code is exactly right.

Because these are consequential mutations in a live account: **read the page, state
what you are about to change, get an explicit yes, then act.**

Work by goal, and for each step: **read the page, state what you are about to
change, get an explicit yes, then act.** Creating a Channel, attaching a platform,
and issuing a key are consequential mutations in a live account. Never click a
control you have not read.

If a goal has no obvious control on the page, say so and ask the developer what
they see. That is faster and safer than guessing.

## The four things that must line up

Every failure in this phase collapses into the same silent `setup_required`, so
check all four rather than assuming:

1. **The Channel's Code matches what the code declares**, character for character.
   Lowercase kebab-case. `examples/OpenTag` declares `open-tag` by default; set
   `INTELLIGENCE_CHANNEL_NAME` to whatever Code you actually created.
2. **A Slack adapter is attached to that Channel and reports connected.** Created
   is not connected. The Channel's Overview should read **Setup complete** under
   Platform setup.
3. **The Channel and the API key belong to the same project.** The key selects the
   project; a key from another project activates a different Channel set entirely
   and looks like a name mismatch.
4. **The endpoint defaults are untouched.** Leave `INTELLIGENCE_API_URL` and
   `INTELLIGENCE_GATEWAY_WS_URL` unset so both default to production. If an
   inherited `.env` points either at `dev.intelligence.copilotkit.ai`, that is out
   of scope — say so and stop rather than silently validating the wrong
   environment.

## The order to do it in

1. **Sign in** and select or create a project. One project per environment is the
   documented convention — do not point a local runtime at a project a deployed
   service is using.
2. **Create the Channel**, named exactly what the code declares. Get this from the
   code, not from memory:

   ```bash
   grep -rn "CHANNEL_NAME\|CHANNEL_CODE\|createChannel(" app/ server.ts .env.example
   ```

   Naming it after the display name instead of the code's name is a common and
   confusing failure — a Channel shown as "OpenTag (Dev)" whose name is
   `open-tag` is fine; a Channel whose *name* is `OpenTag (Dev)` is not.
3. **Attach the Slack adapter** — the wizard's **Setup** step. Two fields, both
   **typed by the developer**: **Bot token** (`xoxb-…`, from OAuth & Permissions)
   and **Signing secret** (from Basic Information → App Credentials). There is no
   app-level-token field, because managed delivery does not use Socket Mode. Tell
   them which field takes which value; never take the values yourself.
4. **Issue a project-scoped runtime API key.** The developer copies it straight
   into `.env` as `INTELLIGENCE_API_KEY`. It should not pass through the chat.

## Reading the status

Before your runtime connects, the Channel is expected to show that it is waiting
for a runtime. Once your process activates it, it should flip to **Online**.

- **Waiting for runtime, while your process is running** → the process is not
  reaching this Channel: Code mismatch, wrong project, or the key is not the one
  in `.env`.
- **Online, while your process is stopped** → something else is claiming this
  Channel. Find it before starting yours.
- **Online, while your process runs** → this phase is done. Overview should show
  Platform setup **Setup complete** and Runtime **Connected**.

Two dashboard fields that are **not** health signals, so do not diagnose with
them:

- **Agent run** on the Channel's Threads tab reads `—`, and Overview shows
  **AGENT: Not declared**, even after a turn completes successfully. The runtime
  does not declare an agent identity the dashboard recognises.
- A Channel's Threads tab lists an `…:activation` pseudo-thread alongside real
  message threads. Its presence means the runtime activated, not that anyone was
  answered.

The tab that *does* prove a round trip is **Usage**: `Completed turns`, `Inbound`,
`Outbound`, and `quota blocked`. One completed turn with a non-zero Outbound means
Slack got a reply.

## One consumer per Channel

Managed delivery is claim-based. Two runtimes declaring the **same Channel name in
the same project** race for each delivery, and the loser gets nothing — silently.
The tell is a reply appearing in Slack that your terminal knows nothing about.

Give the local runtime its own project, or at minimum stop the other consumer.
Never run a laptop runtime against a Channel a deployed service is serving.

## If the dashboard cannot do what this phase needs

Managed Channels are **enabled by default on production Intelligence for
everyone**, so expect creating a Channel and attaching Slack to be available. If
they are not — with all four alignments verified you see any of:

- no option to attach a Slack platform to a Channel at all,
- no way to create a Channel in the project, or
- a Channel that stays `setup_required` with a correctly attached Slack adapter,

then this is **unexpected**, not a known limitation to route around. **Stop and
say so plainly**, with what you observed: it is an account or platform question
for the CopilotKit team.

Do **not** respond by switching to a direct Slack adapter, and do not point the
runtime at a non-production Intelligence environment. Both are out of scope, and
both mean the developer ends up validating something other than what they asked
about. Report the blocker and let them decide.

## Things that are not required

The runtime needs the API key and the Channel name. It does **not** need an
organization id, project id, Channel id, or runtime-instance id in its
environment, and it does **not** need Slack credentials. If you find yourself
hunting for those, re-read the app's env parser — you are solving a problem it
does not have.
