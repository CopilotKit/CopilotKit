# Slack workspace and app

Goal: a **dedicated** Slack app, installed in a workspace where an in-progress
bot is harmless, with its two tokens in hand.

## Pick a workspace

In preference order:

1. **A workspace the developer can install into** — their own, or one where they
   are an owner or app manager.
2. **A new free workspace**, created at `slack.com/create`. Fastest path when
   company approval would block them. A free workspace is fine for this.
3. **A Slack Developer Program sandbox** — a workspace intended for app
   development.

Never test in a workspace where an unapproved or half-built bot would disrupt
people. That is the whole reason installs are gated.

## Understand the approval boundary before promising a timeline

- **Creating** an app is normally not gated (an Enterprise Grid org may restrict
  it; if so, the developer will hit that immediately and should ask their admin).
- **Installing** it into a workspace is the gated step. By default only Workspace
  Owners can review app requests, and they may appoint other members as **app
  managers** to review them too.
- **Changing scopes later forces re-approval and re-installation.** Get the
  manifest right the first time rather than adding scopes incrementally — this is
  also why you should not add scopes to someone else's app for your convenience.
- **Bot display names and slash-command names are workspace-wide.** Slack blocks
  an install whose bot name or command name is already taken in that workspace.
  The wizard warns about this; resolve it by choosing a more specific Channel
  display name, not by renaming commands the Channel implements.

So: create the app immediately, and start the install request in parallel if one
is needed. Do not sit idle waiting for approval before creating.

## Create the app from the Channel wizard's manifest

**There is exactly one correct manifest: the one the Intelligence Channel wizard
generates** (Phase 1, the Setup step — "Copy manifest" / "View manifest YAML"). It
is already pointed at the Channel's Request URL. Copy it from there.

Do **not** use either of these:

- **The starter's own `slack-app-manifest.yaml`.** It sets
  `socket_mode_enabled: true` and declares no `request_url` — the *direct-adapter*
  shape. An app created from it installs cleanly and never delivers an event to
  Intelligence.
- **`assets/slack-app-manifest.yaml`** in this skill. Same problem; it is retained
  only as a reference for what the direct-adapter shape looks like.

The generated manifest deliberately contains **no `slash_commands`** and sets
`interactivity.is_enabled: false`, because the managed adapter does not deliver
those payloads. Do not add them back, and do not invent a Request URL for them.

Then, in a browser at `api.slack.com/apps`: create a new app **from an app
manifest**, choose the workspace, paste the manifest, review the requested
scopes, and create it.

Two paste-time gotchas:

- Slack's manifest editor **lints empty strings** and refuses to advance with a
  generic "We can't translate a manifest with errors" that names no field. A
  `usage_hint: ""` is the usual culprit (the OpenTag manifest ships two). Delete
  the empty keys rather than blanking them.
- The editor auto-closes brackets as you type. Paste **minified, single-line**
  JSON to avoid mangling, and confirm it parses before advancing.

Before creating, change `display_information.name` and
`features.bot_user.display_name` so the bot is obviously a dev app in the member
list. Two bots with the same name in one workspace is a support burden for
whoever finds it later.

**Never paste a manifest over an app that is already installed and in use.** That
can reinstall it and rotate its tokens, breaking every consumer holding the old
ones. Configuring a *new* app is the only safe path.

## Install it and collect the two credentials

1. **Install to the workspace** and complete the OAuth consent.
2. Copy the **bot token** — OAuth & Permissions → Bot User OAuth Token (`xoxb-…`).
3. Copy the **signing secret** — Basic Information → App Credentials → Signing
   Secret.

Both go into the Slack adapter form in Intelligence, entered by the developer.
Neither belongs in this repo, in `.env`, or in the conversation — see
`references/secrets-and-credentials.md`.

They must come from the **same app**. A mismatched pair cannot be detected during
setup: it looks configured and never delivers.

**Do not open the Install App page to read the token** — it renders it in plain
text. Use OAuth & Permissions, and have the developer copy it themselves.

If you changed the manifest after the first install, Slack shows a banner asking
you to **reinstall**. That is required for the new scopes to take effect, and it
issues a **new bot token** — so reinstall *before* copying the token, never after.

## Settings that must stay as the manifest sets them

| Setting | Expected | Why |
| --- | --- | --- |
| **Socket Mode** | **disabled** | Managed delivery is HTTPS to Intelligence's Request URL. Socket Mode is the direct-adapter path; enabling it here delivers nothing. |
| **Event subscriptions → Request URL** | `https://intelligence.copilotkit.ai/api/channels/adapters/slack/events` | This is the whole delivery mechanism. Absent or wrong = permanent silence. |
| **Event subscriptions → bot events** | includes `app_mention`, `message.im` | `app_mention` for channel mentions, `message.im` for DMs. Editing the app after install can drop these. |
| **Interactivity** | disabled | The managed adapter does not deliver interactive payloads. Enabling it does not make buttons work, it just implies they should. |

## Invite the bot to a test channel

Workspace-installed is **not** the same as channel member. Slack does not emit
`app_mention` at all for a channel the app is not in — it shows the human an
invite prompt instead, and nothing reaches your runtime.

```
/invite @YourBot
```

Prefer a channel the developer created for this. A DM to the bot also works for
testing, but check which handlers the app registers first: an app with only
`onMention` ignores plain DMs (see `references/troubleshooting.md`).

## Phase 2 is done when

- The app exists and is **installed** in the chosen workspace, created from the
  **wizard's** manifest.
- Socket Mode is **off** and the events Request URL points at Intelligence.
- An `xoxb-` bot token and the **signing secret** from **that** app are in the
  developer's hands, and neither has touched the repo or the chat.
- The bot appears in the member list of the test channel.

## What not to do

- Do not create the app for the developer by driving their browser session, and do
  not enter credentials on their behalf.
- Do not request scopes beyond the manifest.
- Do not enumerate the workspace's channels or users. You need one test channel,
  which the developer names.
- Do not touch an existing app to "save time." Creating a new one takes minutes;
  breaking a shared bot costs someone else their day.
