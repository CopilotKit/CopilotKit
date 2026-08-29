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
- Open-source - Full transparency and community-driven

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

## Trusted Inspector metadata

An Intelligence-backed v2 runtime can proxy trusted project and license context
to the Inspector. The runtime advertises this support with
`inspectorMetadata: true` in its runtime-info response.

| Runtime mode | Request                                                     |
| ------------ | ----------------------------------------------------------- |
| Multi-route  | `GET {basePath}/inspector-metadata`                         |
| Single-route | `POST {basePath}` with `{ "method": "inspector/metadata" }` |

A valid response is a sanitized `InspectorMetadataV1` JSON object with
`Cache-Control: no-store, private`. Missing data, an unsupported schema, a
non-Intelligence runtime, or a provider failure returns `204` with the same
cache policy. This optional request never changes the main runtime connection
state. The upstream Intelligence request has a five-second deadline; a timeout
uses the same private `204` path.

Runtime keeps `schemaVersion: 1` and returns the object normalized by Shared.
Older producers may omit `usage.expiringSoonCount`, and `0` stays a known zero.
If this optional leaf is malformed, Shared removes only the leaf and keeps valid
base usage and sibling modules. Runtime does not calculate or cache expiry, and
older consumers ignore the additive leaf.

The Intelligence request uses the API key configured on the server-side
`CopilotKitIntelligence` client. The proxy does not forward browser headers or
cookies to Intelligence, and it does not expose provider error bodies to the
browser. Browser headers and configured fetch credentials still apply between
`@copilotkit/core` and your Copilot Runtime, so you can protect the runtime route
with your normal app auth.

Deploy the Intelligence producer before releasing a runtime that advertises the
capability. New runtimes treat a `404` from an older Intelligence App API as
compatible absence and return `204` to the client.

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
