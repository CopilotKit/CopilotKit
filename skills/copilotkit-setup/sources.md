# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-03-28

## framework-detection.md
- examples/v2/ (Angular, React, Node, Node-Express, Next Pages Router directory structures)
- examples/integrations/ (integration example directory structures for framework patterns)
- packages/v2/runtime/src/ (endpoint factories: createCopilotEndpoint, createCopilotEndpointExpress, createCopilotEndpointSingleRoute)
- packages/v2/react/src/ (CopilotKitProvider props, stylesheet imports)
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
- packages/v2/react/src/ (CopilotKitProvider, CopilotChat component exports)
- examples/v2/react/ (Next.js App Router page component patterns)
