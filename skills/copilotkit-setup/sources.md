# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-09-08

## framework-detection.md

- examples/v2/ (Angular, React, Node, Node-Express, Next Pages Router directory structures)
- examples/integrations/ (integration example directory structures for framework patterns)
- packages/runtime/src/v2/runtime/ (endpoint factories: createCopilotRuntimeHandler, createCopilotHonoHandler, createCopilotExpressHandler)
- packages/react-core/src/v2/ (`CopilotKit` provider props, stylesheet imports)
- packages/angular/src/ (Angular component package structure)

## runtime-architecture.md

- packages/runtime/src/v2/runtime/ (CopilotRuntime, CopilotRuntimeOptions, AgentRunner, InMemoryAgentRunner, IntelligenceAgentRunner)
- packages/runtime/src/v2/runtime/endpoints/ (createCopilotRuntimeHandler, createCopilotHonoHandler, createCopilotExpressHandler, CORS config, route definitions)
- packages/runtime/src/v2/runtime/intelligence-platform/ (CopilotKitIntelligence, CopilotSseRuntime, CopilotIntelligenceRuntime)
- packages/runtime/src/agent/ (BuiltInAgent, BasicAgent, defineTool, ToolDefinition, resolveModel, MCPClientConfig)
- packages/shared/src/ (TranscriptionService, BeforeRequestMiddleware, AfterRequestMiddleware)

## assets/express-runtime.ts

- packages/runtime/src/v2/runtime/ (CopilotRuntime constructor, createCopilotExpressHandler)
- packages/runtime/src/agent/ (BuiltInAgent, defineTool, ToolDefinition)
- examples/v2/node-express/ (Express server setup patterns)

## assets/nextjs-app-router-route.ts

- packages/runtime/src/v2/runtime/ (CopilotRuntime, createCopilotHonoHandler, InMemoryAgentRunner)
- packages/runtime/src/agent/ (BuiltInAgent)
- examples/v2/react/ (Next.js App Router route handler patterns)

## assets/nextjs-app-router-page.tsx

- packages/react-core/src/v2/ (`CopilotKit` provider, CopilotChat component exports)
- examples/v2/react/ (Next.js App Router page component patterns)

## Step 2 Intelligence runtime and Step 6 (added 2026-08-01)

- packages/runtime/src/v2/runtime/core/runtime.ts (CopilotIntelligenceRuntimeOptions:
  `intelligence`, required `identifyUser`, `channels`; CopilotSseRuntimeOptions has
  `channels?: undefined`)
- packages/runtime/src/v2/runtime/intelligence-platform/client.ts
  (CopilotKitIntelligenceConfig: required `apiKey`, optional `apiUrl`/`wsUrl` defaulting to
  the managed platform, separate API and realtime hosts)
- examples/slack/app/managed.ts (canonical managed wiring and env var names)
- apps/cli help output in CopilotKit/Intelligence (the command is `login`, not `auth`)
- CopilotKit/Intelligence `2026-08-01-teams-one-command-setup-prd.md` (Teams provider setup
  starts from a durable browser draft; Fast CLI and Guided manual are peer paths; provider
  completion is separate from runtime and message verification)
