---
name: copilotkit-channels
description: >
  Use when connecting a CopilotKit agent to Slack or Microsoft Teams with managed
  Intelligence Channels. Covers customising the Channel a CLI-scaffolded project
  already ships, and — for a project the CLI did not generate — the Channel
  declaration, the long-running host requirement, and the awaited activation call.
version: 1.0.0
---

# CopilotKit Channels

Managed Channels let an agent answer in Slack or Microsoft Teams. Intelligence owns the provider edge — signed ingress, egress, credential storage — and delivers turns to your runtime over its realtime transport.

## Scope

This skill covers **managed Intelligence Channels**: `CopilotIntelligenceRuntime`, app-api Channel resources, and the realtime gateway.

It does **not** cover the self-hosted `@copilotkit/channels` provider adapters (`@copilotkit/channels-slack`, `-teams`, `-discord`, `-telegram`, `-whatsapp`). Those hold provider credentials in your process and talk to the provider directly. Both products use the words "channels" and "Slack", so confirm which one the user means before wiring anything. If they want to hold their own Slack tokens and run their own ingress, they want the adapter packages, not this skill.

## Decide which path you are on first

Everything below depends on this, and getting it wrong produces a project with two Channel declarations that fight over one Channel.

**Look for `channel-host.mts` at the project root.**

| It is there                                                                                                                                                                             | It is not                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The project was scaffolded by `npx copilotkit init`. The code half is **already done** — go to "Customising a scaffolded Channel". Do not write a new host or a second `createChannel`. | The project predates the Channel, or was not made by the CLI. Go to "Wiring a project the CLI did not generate", at the end. |

The scaffolded path is the one exercised end to end. Wiring an existing project is supported and works, but it is less trodden: the CLI reads source it did not generate, so a project laid out unusually may get a `status` leg reported as `undetermined` rather than a confident answer. That is deliberate — an unsure answer beats a wrong one — but verify the wiring yourself there rather than trusting a green report.

## A Channel has two halves

A Channel only works when both are correct, and each half is invisible from the other:

1. **The provider half** — an app registered with Slack or Microsoft, credentials stored server-side, ingress pointed at Intelligence. Three doors to it, all reconciling against the same server state so any can finish what another started: `npx copilotkit init` leads an interactive developer through the whole thing during setup; `npx copilotkit channels add` does it for an existing project or an agent; the dashboard wizard does it in a browser.
2. **The code half** — a long-running runtime that declares the Channel and awaits activation. A scaffolded project **already has this**; for anything else, it is what this skill writes.

The most confusing failure in this product is a correct provider half with a missing code half: the app serves HTTP normally, reports no error, shows an encouraging badge in the dashboard, and answers nothing. Nothing in the browser can diagnose it, because the missing piece is in the source tree.

## Customising a scaffolded Channel

A scaffolded project ships three files, and only one of them is yours to change:

| File                               | What it is                                                    | Change it?                                                  |
| ---------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `channels.mts`                     | The Channel: its name resolution, its agent, and its handlers | **Yes — this is where customisation goes**                  |
| `channel-host.mts`                 | The process that owns the Channel's lifetime                  | No. It is identical in every starter and for every provider |
| `src/agent.ts` (or `app/agent.ts`) | The agent both the web route and the Channel serve            | Only to change the agent itself                             |

Run it with:

```bash
npm run channel
```

It prints `Channel "<name>" is online` when the gateway connection is live, or `declared but no provider is attached yet` when the provider half is unfinished — which is a waiting state, not an error.

### What to change, and where

Everything happens inside `createDefaultChannel` in `channels.mts`, on the `channel` object before it is returned:

```typescript
// Reply to a thread the bot is mentioned in, in addition to the messages it
// already handles. Registering onMention does NOT replace onMessage: a
// non-mention turn is only ever dispatched to message handlers, so removing
// onMessage makes the bot silent in DMs and on 1:1 platforms.
channel.onMention(async ({ thread, message }) => {
  /* ... */
});

// Act on a reaction. `added` distinguishes an added emoji from a removed one,
// and `thread` is the conversation it happened in.
channel.onReaction(async ({ thread, emoji, added }) => {
  /* ... */
});
```

`onCommand` is deliberately absent from this list. Managed Slack Channels are events-only — there is no managed slash-command ingress — so registering one produces a handler nothing will ever call.

Per-provider tools and context (`defaultSlackTools`, `defaultSlackContext`) are a deliberate omission from the scaffold, not an oversight: importing them makes the file provider-specific, and the scaffolded Channel is not. Add them here when the project only ever targets one provider.

### Two things not to do to a scaffolded project

- **Do not add a second `createChannel`.** The host resolves exactly one Channel name from `.copilotkit/channels.json` and refuses to start when several are declared. A second declaration in source does not produce a second bot; it produces a project that will not boot.
- **Do not move the Channel into the Next.js route.** That route is serverless and cannot hold a connection open. The separate host exists for that reason.

## Verify — either path

```bash
npx copilotkit channels status
```

That compares three things that must agree — the declared configuration, the project source, and the server — and names whichever is missing. Then:

1. Start the long-running host — `npm run channel` in a scaffolded project. It should log the activation.
2. Invite the bot to a channel (`channels status` prints the invite command with the right handle).
3. Message the bot. You should get a reply.

If nothing happens and there is no error, check in this order: is `activateChannels: false` set anywhere; on a deferring mount, is `ready()` awaited; is `intelligence` passed (not a `runner`); is the realtime URL correct; on Slack, was the app **reinstalled** after creation and the bot invited.

"Reinstalled" is not a typo. Slack installs the app when it creates it, with two of its scopes, and only a reinstall grants the rest — see "Online, silent, and nothing in the log at all" below.

Do not report a Channel as working because credentials were stored. A stored adapter proves the credentials are real — the server probed them — and nothing more. It does not prove the app is installed, that a channel was invited, or that a runtime is connected.

### Online, but silent — a different failure

That checklist only covers a Channel that never connected. If the host logs `Channel "<name>" is online` and the bot still says nothing, the code half is **fine** — activation succeeded — and every item above will come back correct. Walking the list again is wasted time.

Look in the host's own output for:

```
{ meta: { deliveryId: 'dlv_...', errorCategory: 'validation' } } channel delivery claim or join failed
```

That is the runtime rejecting the turn the server sent it, at the join boundary, before any handler runs. Nothing is posted back to the provider on this path, which is why it looks like silence rather than an error.

The usual cause is a **version disagreement between the installed `@copilotkit/channels-*` packages and the Intelligence deployment serving them**. The runtime validates each delivery strictly — exact field sets, not a loose subset — so a client expecting a field its server does not yet send fails every turn of that kind, while a Channel that never receives one (Teams-only, or an idle Slack app) looks perfectly healthy.

So:

1. Note the installed versions: `npm ls @copilotkit/runtime @copilotkit/channels`.
2. Compare them with the Intelligence deployment. On hosted Intelligence, a canary or prerelease client can run ahead of what is deployed. On self-hosted, the deployment is usually the one that lags.
3. Move them onto matching lines. Pinning the client to a prerelease is the common way into this state.

`errorCategory` is a classification, not the message — the underlying error text is deliberately not logged, so the category plus this note is the whole signal you get.

### Online, silent, and nothing in the log at all — a short-scoped Slack token

If the host logs online, the bot says nothing, and there is **no delivery line of any kind** in its output, the turn never reached you: Slack never sent it. On Slack that is almost always a bot token that was copied too early.

Creating a Slack app from a manifest **installs it**, and that install grants only two scopes — `channels:history` and `chat:write`. The manifest's declared scopes reach the app's configuration but not the grant, which is what Slack's yellow "you've changed the permission scopes" banner is reporting. One **Reinstall to Workspace → Allow** raises the grant to the full set.

A token copied before that reinstall is the trap, because every check still passes:

- `auth.test` succeeds, so attaching stores it and reports the adapter healthy.
- `chat:write` is present, so the bot can post — it is not obviously broken.
- `app_mentions:read` is absent, so Slack never delivers `app_mention`, and no handler ever runs.

The result is a Channel that is genuinely online and structurally deaf. Distinguishing it from the version disagreement above is easy once you know to look: that failure logs a rejected delivery, this one logs nothing, because there is nothing to reject.

Fix it by reinstalling the Slack app, copying the reissued Bot User OAuth Token — reinstalling issues a new one — and rotating the stored credential (`npx copilotkit channels rotate <name> --adapter slack`).

Intelligence now refuses a short-scoped token when it is pasted, with `CHANNEL_ADAPTER_SLACK_TOKEN_SCOPES_INCOMPLETE`, and names the missing scopes. Treat that error as this problem caught early rather than as a setup failure. A Channel attached before that check existed can still be sitting in this state, and only a rotation clears it.

If a reinstall does not fix it, the app predates the current manifest and its stored configuration is short too: paste the current manifest into **App Manifest** in the Slack app, then reinstall.

## Wiring a project the CLI did not generate

Everything from here down is the hand-wiring path — the less-trodden one. If `channel-host.mts` exists, you are in the wrong section.

### Prerequisites

A scaffolded project satisfies all four of these already. Before starting, confirm all four. Stop and fix any that fail — each one produces a silent failure rather than an error.

1. **The Intelligence runtime is wired.** `channels` is not available in SSE mode; the type is `channels?: undefined` there. If the project still constructs `CopilotRuntime` with a `runner` and no `intelligence`, do the managed Intelligence step in the **copilotkit-setup** skill first.
2. **A long-running host.** Activation opens a persistent connection, so the process has to outlive a request. A Next.js route handler on serverless, a Lambda, or an edge function cannot host a Channel. See "Deployment shape" below.
3. **The hosted environment values are set** — the project API key, and the realtime URL if you are overriding defaults.
4. **The provider half exists, or is in progress.** The two halves can be done in either order; a Channel simply does not answer until both are done.

### Step 1: Install

```bash
npm install @copilotkit/channels
```

`@copilotkit/channels` provides `createChannel`. The managed transport itself is built into `@copilotkit/runtime` — there is no separate adapter package to install for the managed path, and no provider credentials in your process.

### Step 2: Declare the Channel

The Channel's `name` is chosen here, in code. It is the project-unique identifier the runtime uses to derive the managed Channel's activation config — project id, adapter, socket URL and auth — so you supply none of those.

```typescript
import { createChannel } from "@copilotkit/channels";

const support = createChannel({
  // Must match the Channel name configured on the provider half.
  // Lowercase kebab-case, unique within the project.
  name: "support",
  agent: (threadId) => {
    const agent = new MyAgent();
    agent.threadId = threadId;
    return agent;
  },
});

support.onMention(async ({ thread, message }) => {
  await thread.runAgent({
    // Channel history does NOT include the in-flight turn, so pass the current
    // message explicitly -- otherwise the agent runs with zero messages.
    prompt: message.contentParts?.length ? message.contentParts : message.text,
  });
});
```

The agent is **framework-agnostic**: `agent` accepts any AG-UI `AbstractAgent`, including a remote one. A Python or .NET agent stays exactly where it is and a small TypeScript host proxies to it — adopting Channels never means porting an agent.

### Step 3: Pass the Channel to the runtime

```typescript
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";

const intelligence = new CopilotKitIntelligence({
  apiKey: process.env.COPILOTKIT_API_KEY!,
});

const runtime = new CopilotRuntime({
  // A Channel supplies its own agent, so runtime-hosted agents are optional here.
  agents: {},
  intelligence,
  identifyUser: (request) => resolveUserFromSession(request),
  channels: [support],
});
```

### Step 4: Mount a long-running host

```typescript
import { createServer } from "node:http";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const listener = createCopilotNodeListener({
  runtime,
  basePath: "/api/copilotkit",
});

createServer(listener).listen(Number(process.env.PORT ?? 8300));

// Optional on this mount, and worth doing: it turns a failed activation into a
// startup failure instead of a line in the logs.
await listener.channels.ready({ timeoutMs: 30_000 });
```

#### Whether you must call `ready()` depends on the mount

This is the single most misunderstood thing about Channels. Activation is **not** lazy everywhere.

| Mount                                         | Activation                          | Is `ready()` required?   |
| --------------------------------------------- | ----------------------------------- | ------------------------ |
| `createCopilotNodeListener`                   | Starts when the listener is created | No — await it to observe |
| `createCopilotExpressHandler`                 | Starts when the router is created   | No — await it to observe |
| `createCopilotHonoHandler`                    | Deferred to the first `ready()`     | **Yes**                  |
| `createCopilotRuntimeHandler` (generic fetch) | Deferred to the first `ready()`     | **Yes**                  |
| any mount with `activateChannels: false`      | None; no control surface, no socket | Nothing will connect     |

The two lifecycle-owning wrappers start on their own because they own their process lifetime — a declared Channel connects because it was declared, and there is no incantation to forget. The fetch and hono handlers defer on purpose: they are the serverless and edge entry points, where an isolate freezes and recycles per request and separate cold starts would mint competing listeners for the same Channel.

So the silent failure — a process that serves HTTP, looks healthy, and answers nothing — happens on a **deferring** mount when nothing ever calls `ready()`. On a node or express host, a missing `ready()` is not that failure.

Two details either way:

- `ready()` is **one-shot** and idempotent. It settles on the initial activation outcome, so awaiting it after an auto-start observes that activation rather than triggering a second one. It can resolve as `setup_required`, which means activation settled — not that delivery is healthy. Treat only `status().overall === "online"` as connected.
- Pair activation with shutdown so a redeploy releases the connection cleanly:

  ```typescript
  process.on("SIGTERM", async () => {
    await listener.channels.stop();
    process.exit(0);
  });
  ```

### Deployment shape

Deciding whether the project already has a long-running host is the judgement this skill exists to make. Detect the framework first (see the **copilotkit-setup** skill's `references/framework-detection.md`), then:

| What the project runs today                    | What to do                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| A standalone Node/Express/Hono server          | Declare the Channel on the runtime it already has                |
| Next.js on Vercel, Lambda, or an edge function | Add a **separate** long-running process for the Channel          |
| A Python or .NET agent                         | Leave it alone; add a small TypeScript channel host that proxies |

A separate process is **not** mandated. If the project already runs a long-running runtime — one serving a React UI, for instance — that same runtime can declare Channels. A second process is required only when the existing runtime is serverless.

When a separate host is needed, it is a small program: the runtime, the Channel, and the awaited ready call. It does not need to serve the UI, and it does not need an HTTP server at all — nothing calls it. The gateway connection is outbound, and holding it open is what keeps the process alive. The scaffolded `channel-host.mts` is exactly this, and is worth reading as the reference implementation even when writing one by hand.

## Never do these

- **Do not write provider credentials into the project** for a managed Channel. Intelligence stores them server-side; the runtime never reads them. If the project holds a Slack bot token for a managed Channel, something is wired wrong.
- **Do not put a Channel on a serverless route handler.** It will appear to deploy and never connect.
- **Do not assume `ready()` is required, or that it is optional.** Check the mount. Telling someone to add a call they do not need is as unhelpful as omitting one they do.
- **Do not pass `runner` alongside `intelligence`.** That is what silently keeps threads in memory.
- **Do not hand-wire a Channel into a scaffolded project.** If `channel-host.mts` is present the code half is done; adding a second declaration stops the host from booting rather than adding a bot.
- **Do not invent Channel infrastructure ids.** Project, adapter, and channel ids are derived from the Intelligence config plus the Channel `name`.
