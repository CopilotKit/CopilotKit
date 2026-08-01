---
name: copilotkit-channels
description: >
  Use when connecting a CopilotKit agent to Slack or Microsoft Teams with managed
  Intelligence Channels. Covers the Channel declaration, the long-running host
  requirement, the awaited activation call, and how the code half pairs with the
  provider setup done by the CLI or the dashboard wizard.
version: 1.0.0
---

# CopilotKit Channels

Managed Channels let an agent answer in Slack or Microsoft Teams. Intelligence owns the provider edge — signed ingress, egress, credential storage — and delivers turns to your runtime over its realtime transport.

## Scope

This skill covers **managed Intelligence Channels**: `CopilotIntelligenceRuntime`, app-api Channel resources, and the realtime gateway.

It does **not** cover the self-hosted `@copilotkit/channels` provider adapters (`@copilotkit/channels-slack`, `-teams`, `-discord`, `-telegram`, `-whatsapp`). Those hold provider credentials in your process and talk to the provider directly. Both products use the words "channels" and "Slack", so confirm which one the user means before wiring anything. If they want to hold their own Slack tokens and run their own ingress, they want the adapter packages, not this skill.

## A Channel has two halves

A Channel only works when both are correct, and each half is invisible from the other:

1. **The provider half** — an app registered with Slack or Microsoft, credentials stored server-side, ingress pointed at Intelligence. Done with `npx copilotkit channels add` or the dashboard wizard.
2. **The code half** — a long-running runtime that declares the Channel and awaits activation. **That is what this skill does.**

The most confusing failure in this product is a correct provider half with a missing code half: the app serves HTTP normally, reports no error, shows an encouraging badge in the dashboard, and answers nothing. Nothing in the browser can diagnose it, because the missing piece is in the source tree.

## Prerequisites

Before starting, confirm all four. Stop and fix any that fail — each one produces a silent failure rather than an error.

1. **The Intelligence runtime is wired.** `channels` is not available in SSE mode; the type is `channels?: undefined` there. If the project still constructs `CopilotRuntime` with a `runner` and no `intelligence`, do the managed Intelligence step in the **copilotkit-setup** skill first.
2. **A long-running host.** Activation opens a persistent connection, so the process has to outlive a request. A Next.js route handler on serverless, a Lambda, or an edge function cannot host a Channel. See "Deployment shape" below.
3. **The hosted environment values are set** — the project API key, and the realtime URL if you are overriding defaults.
4. **The provider half exists, or is in progress.** The two halves can be done in either order; a Channel simply does not answer until both are done.

## Step 1: Install

```bash
npm install @copilotkit/channels
```

`@copilotkit/channels` provides `createChannel`. The managed transport itself is built into `@copilotkit/runtime` — there is no separate adapter package to install for the managed path, and no provider credentials in your process.

## Step 2: Declare the Channel

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

## Step 3: Pass the Channel to the runtime

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

## Step 4: Mount a long-running host and activate

```typescript
import { createServer } from "node:http";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const listener = createCopilotNodeListener({
  runtime,
  basePath: "/api/copilotkit",
});

createServer(listener).listen(Number(process.env.PORT ?? 8300));

// THIS is what connects the Channel. Mounting the listener opens no connection.
await listener.channels.ready();
```

**`await listener.channels.ready()` is the whole ballgame.** Channel activation is lazy on every host, including node and express — deliberately, so serverless and edge deployments stay safe. The gateway connection opens on the first awaited ready call and never before. A long-running host that omits it serves HTTP and connects nothing.

There is no framework where activation happens implicitly. Whatever the host, the call must be present.

Two details worth knowing:

- `ready()` is **one-shot**: it settles on the initial activation outcome, not on later reconnects.
- Pair it with shutdown so a redeploy releases the connection cleanly:

  ```typescript
  process.on("SIGTERM", async () => {
    await listener.channels.stop();
    process.exit(0);
  });
  ```

## Deployment shape

Deciding whether the project already has a long-running host is the judgement this skill exists to make. Detect the framework first (see the **copilotkit-setup** skill's `references/framework-detection.md`), then:

| What the project runs today                    | What to do                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| A standalone Node/Express/Hono server          | Declare the Channel on the runtime it already has                |
| Next.js on Vercel, Lambda, or an edge function | Add a **separate** long-running process for the Channel          |
| A Python or .NET agent                         | Leave it alone; add a small TypeScript channel host that proxies |

A separate process is **not** mandated. If the project already runs a long-running runtime — one serving a React UI, for instance — that same runtime can declare Channels. A second process is required only when the existing runtime is serverless.

When a separate host is needed, it is a small program: the runtime, the Channel, the listener, the ready call. It does not need to serve the UI, and there is no public provider ingress on its port — Intelligence owns the provider edge.

## Step 5: Verify

```bash
npx copilotkit channels status
```

That compares three things that must agree — the declared configuration, the project source, and the server — and names whichever is missing. Then:

1. Start the long-running host. It should log the activation.
2. Invite the bot to a channel (`channels status` prints the invite command with the right handle).
3. Mention the bot. You should get a reply.

If nothing happens and there is no error, check in this order: is `ready()` awaited; is `intelligence` passed (not a `runner`); is the realtime URL correct; is the app installed and invited.

Do not report a Channel as working because credentials were stored. A stored adapter proves the credentials are real — the server probed them — and nothing more. It does not prove the app is installed, that a channel was invited, or that a runtime is connected.

## Never do these

- **Do not write provider credentials into the project** for a managed Channel. Intelligence stores them server-side; the runtime never reads them. If the project holds a Slack bot token for a managed Channel, something is wired wrong.
- **Do not put a Channel on a serverless route handler.** It will appear to deploy and never connect.
- **Do not pass `runner` alongside `intelligence`.** That is what silently keeps threads in memory.
- **Do not invent Channel infrastructure ids.** Project, adapter, and channel ids are derived from the Intelligence config plus the Channel `name`.
