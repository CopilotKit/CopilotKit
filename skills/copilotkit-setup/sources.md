# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-03-28

## framework-detection.md

- examples/v2/ (Angular, React, Node, Node-Express, Next Pages Router directory structures)
- examples/integrations/ (integration example directory structures for framework patterns)
- packages/v2/runtime/src/ (endpoint factories: createCopilotEndpoint, createCopilotEndpointExpress, createCopilotEndpointSingleRoute)
- packages/v2/react/src/ (`CopilotKit` provider props, stylesheet imports)
- packages/v2/angular/src/ (Angular component package structure)

## runtime-architecture.md

- packages/v2/runtime/src/ (CopilotRuntime, CopilotRuntimeOptions, AgentRunner, InMemoryAgentRunner, IntelligenceAgentRunner)
- packages/v2/runtime/src/endpoints/ (createCopilotEndpoint, createCopilotEndpointExpress, createCopilotEndpointSingleRoute, createCopilotEndpointSingleRouteExpress, CORS config, route definitions)
- packages/v2/runtime/src/intelligence-platform/ (CopilotKitIntelligence, CopilotSseRuntime, CopilotIntelligenceRuntime)
- packages/v2/agent/src/ (BuiltInAgent, BasicAgent, defineTool, ToolDefinition, resolveModel, MCPClientConfig)
- packages/v2/shared/src/ (TranscriptionService, BeforeRequestMiddleware, AfterRequestMiddleware)

## assets/express-runtime.ts

- packages/v2/runtime/src/ (CopilotRuntime constructor, createCopilotEndpointSingleRouteExpress)
- packages/v2/agent/src/ (BuiltInAgent, defineTool, ToolDefinition)
- examples/v2/node-express/ (Express server setup patterns)

## assets/nextjs-app-router-route.ts

- packages/v2/runtime/src/ (CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner)
- packages/v2/agent/src/ (BuiltInAgent)
- examples/v2/react/ (Next.js App Router route handler patterns)

## assets/nextjs-app-router-page.tsx

- packages/v2/react/src/ (`CopilotKit` provider, CopilotChat component exports)
- examples/v2/react/ (Next.js App Router page component patterns)

## Step 2 Intelligence runtime and Step 6 (added 2026-08-01)

- packages/runtime/dist/v2/runtime/core/runtime.d.mts (CopilotIntelligenceRuntimeOptions:
  `intelligence`, required `identifyUser`, `channels`; CopilotSseRuntimeOptions has
  `channels?: undefined`)
- packages/runtime/dist/v2/runtime/intelligence-platform/client.d.mts
  (CopilotKitIntelligenceConfig: required `apiKey`, optional `apiUrl`/`wsUrl` defaulting to
  the managed platform, separate API and realtime hosts)
- examples/slack/app/managed.ts (canonical managed wiring and env var names)
- apps/cli help output in CopilotKit/Intelligence (the command is `login`, not `auth`)
- CopilotKit/Intelligence `2026-08-01-teams-one-command-setup-prd.md` (Teams provider setup
  starts from a durable browser draft; Fast CLI and Guided manual are peer paths; provider
  completion is separate from runtime and message verification)

## references/hermes-agui.md (added 2026-08-11)

Pinned source snapshots:

- [Hermes AG-UI adapter README at `b036d8be6d9786a7117777c8c3c2b40a84d2ca3b`](https://github.com/NousResearch/hermes-agent/blob/b036d8be6d9786a7117777c8c3c2b40a84d2ca3b/agui_adapter/README.md) (`hermes agui`, default bind, `POST /`, `GET /health`, existing model/tool ownership, and token security)
- [Hermes AG-UI CLI parser at `b036d8be6d9786a7117777c8c3c2b40a84d2ca3b`](https://github.com/NousResearch/hermes-agent/blob/b036d8be6d9786a7117777c8c3c2b40a84d2ca3b/hermes_cli/subcommands/agui.py) (`hermes agui --check` capability and dependency probe)
- [AG-UI Hermes TypeScript adapter at `add476a459c002e0354f8cf15ff4dfbf3e3329b6`](https://github.com/ag-ui-protocol/ag-ui/blob/add476a459c002e0354f8cf15ff4dfbf3e3329b6/integrations/hermes/typescript/src/index.ts) (the framework-specific class is only a generic `HttpAgent` subclass, so this skill uses the published `@ag-ui/client` transport directly)

The Hermes changes are represented by immutable SHAs because the upstream work was not on a stable release branch when this reference was authored. The setup therefore capability-gates reuse with `hermes agui --check` and never installs or mutates Hermes.
