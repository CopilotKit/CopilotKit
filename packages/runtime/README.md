# CopilotKit - Runtime

<img src="https://github.com/user-attachments/assets/0a6b64d9-e193-4940-a3f6-60334ac34084" alt="banner" style="border-radius: 12px; border: 2px solid #d6d4fa;" />

<br>
<div align="center" style="display:flex;justify-content:center;gap:16px;height:20px;margin: 0;">
  <a href="https://www.npmjs.com/package/@copilotkit/react-core" target="_blank">
    <img src="https://img.shields.io/npm/v/%40copilotkit%2Fruntime?logo=npm&logoColor=%23FFFFFF&label=Version&color=%236963ff" alt="NPM">
  </a>
  <a href="https://github.com/copilotkit/copilotkit/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/github/license/copilotkit/copilotkit?color=%236963ff&label=License" alt="MIT">
  </a>
  <a href="https://discord.gg/6dffbvGU3D" target="_blank">
    <img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" alt="Discord">
  </a>
</div>
<br/>
<div align="center">
  <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily">
  </a>
</div>

## ✨ Why CopilotKit?

- Minutes to integrate - Get started quickly with our CLI
- Framework agnostic - Works with React, Next.js, AGUI and more
- Production-ready UI - Use customizable components or build with headless UI
- Built-in security - Prompt injection protection
- Open source - Full transparency and community-driven

<img src="https://github.com/user-attachments/assets/6cb425f8-ffcb-49d2-9bbb-87cab5995b78" alt="class-support-ecosystem" style="border-radius: 12px; border: 2px solid #d6d4fa;">

## 🧑‍💻 Real life use cases

<span>Deploy deeply-integrated AI assistants & agents that work alongside your users inside your applications.</span>

<img src="https://github.com/user-attachments/assets/3b810240-e9f8-43ae-acec-31a58095e223" alt="headless-ui" style="border-radius: 12px; border: 2px solid #d6d4fa;">

## 🏆 Featured Examples

<p align="center">
  <a href="https://www.copilotkit.ai/examples/form-filling-copilot">
    <img src="https://github.com/user-attachments/assets/874da84a-67ff-47fa-a6b4-cbc3c65eb704" width="300" style="border-radius: 16px;" />
  </a>
  <a href="https://www.copilotkit.ai/examples/state-machine-copilot">
    <img src="https://github.com/user-attachments/assets/0b5e45b3-2704-4678-82dc-2f3e1c58e2dd" width="300" style="border-radius: 16px;" />
  </a>
  <a href="https://www.copilotkit.ai/examples/chat-with-your-data">
    <img src="https://github.com/user-attachments/assets/0fed66be-a4c2-4093-8eab-75c0b27a62f6" width="300" style="border-radius: 16px;" />
  </a>
</p>

## Documentation

To get started with CopilotKit, please check out the [documentation](https://docs.copilotkit.ai).

## Intelligence identity and Memory

An Intelligence Runtime supports web only, Channels only, or both. Web routes
need `identifyUser(request)`. Each Channel has its own `identifyUser` policy in
`createChannel`. A Channels-only Runtime omits the web callback and exposes no
functional web routes.

```ts
const runtime = new CopilotRuntime({
  agents,
  intelligence,
  identifyUser: authenticateApplicationUser,
  channels: [supportChannel],
  memory: {
    access: async ({ request, user, consumer }) => {
      const role = await roleFor(request, user);
      if (role === "blocked") return null;
      return consumer === "client"
        ? { user: "read", project: "none" }
        : { user: "read-write", project: "read" };
    },
  },
});
```

The callback runs once per web request. Its user owns ordinary web Threads and
is reused for agent and browser Memory policy. Adding `memory` exposes the
browser Memory routes and agent tools under the same policy. A denial returns
403; a policy error fails the request. Omitting `memory` hides the browser
routes and does not attach Memory tools.

`exposeMemoryRoutes` and
`CopilotKitIntelligence({ enableEnterpriseLearning: true })` remain for one
compatibility window. New code should use `memory.access`.

## Highly experimental ACP agent

`AcpAgent` translates stable ACP v1 into AG-UI. Intelligence authenticates the
relay and stores its raw ACP frames and remote session ID. The external
deployment owns the ACP process, workspace access, credentials, and lifecycle.

```ts
import {
  AcpAgent,
  CopilotKitIntelligence,
  CopilotRuntime,
} from "@copilotkit/runtime/v2";

const intelligence = new CopilotKitIntelligence({
  apiKey: process.env.COPILOTKIT_API_KEY!,
});

const identifyUser = async (request: Request) => {
  const user = await authenticateApplicationUser(request);
  return { id: user.id, name: user.name };
};

const runtime = new CopilotRuntime({
  intelligence,
  identifyUser,
  agents: async ({ request }) => {
    const user = await identifyUser(request);
    return {
      coding: new AcpAgent({
        intelligence,
        userId: user.id,
        runtimeInstanceId: "rti_external_01",
        agentId: "coding-agent",
        cwd: "/workspace",
      }),
    };
  },
});
```

The external relay connects to Intelligence with the same `runtimeInstanceId`
and `agentId`. An uncertain write on the live channel retries with the same
sender ID. Any socket, channel, or endpoint-process loss ends that transport. A
later run starts at the journal high-water mark and loads the durable remote ACP
session when the agent supports `session/load`; it does not replay an
outcome-unknown prompt into a new ACP SDK connection.

The `cwd` selector crosses the relay inside the raw ACP `session/new` or
`session/load` frame and is stored by Intelligence. Do not put credentials in
it. This client sends no MCP server definitions and advertises no filesystem or
terminal access; deployment-local relay code must own those capabilities.

Permission requests fail closed with ACP's `cancelled` outcome by default. A
long-lived runtime with sticky routing may set `permissionMode: "live"` to emit
AG-UI permission interrupts. Resume must then reach the same live `AcpAgent`
instance or one of its clones. The request expires after five minutes by
default; `permissionTimeoutMs` can set a shorter bound. A second overlapping
permission request fails closed. Do not enable this mode in a multi-replica or
serverless runtime until the app has a durable routing contract.

## Analytics & Privacy

CopilotKit uses [Scarf](https://scarf.sh) for anonymous usage analytics to help improve the product. Scarf handles all privacy compliance and does not store raw IP addresses. This helps us understand how CopilotKit is being used and prioritize improvements.

### Opting Out

To disable analytics, set the environment variable:

```bash
export COPILOTKIT_TELEMETRY_DISABLED=true
```

Or use the `DO_NOT_TRACK` standard:

```bash
export DO_NOT_TRACK=1
```
