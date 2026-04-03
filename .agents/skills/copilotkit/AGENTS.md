# CopilotKit Skills

This plugin provides AI agent skills for working with CopilotKit.

## Available Skills

- `copilotkit-setup` — Add CopilotKit to a project
- `copilotkit-develop` — Build AI features with CopilotKit v2 APIs
- `copilotkit-integrations` — Integration guides for agent frameworks
- `copilotkit-debug` — Diagnose and fix CopilotKit issues
- `copilotkit-upgrade` — Migrate between CopilotKit versions
- `copilotkit-agui` — AG-UI protocol: event types, building custom backends, streaming
- `copilotkit-contribute` — Contribute to CopilotKit OSS
- `copilotkit-self-update` — Update these skills to latest version

## Key Context

- All packages are under `@copilotkit/*`
- Communication uses AG-UI protocol (SSE-based events)
- Use mcp-docs MCP server for querying live CopilotKit documentation

## v2 API (current)

- Hooks: `useAgent`, `useFrontendTool`, `useComponent`, `useAgentContext`, `useInterrupt`, `useSuggestions`, `useHumanInTheLoop`
- Components: `CopilotChat`, `CopilotChatInput`, `CopilotChatMessageView`
- Runtime: `CopilotRuntime`, `AgentRunner`, `BuiltInAgent`

## Deprecated v1 terminology (do NOT use)

- `useCopilotAction` → use `useFrontendTool`
- `CoAgents` → use `useAgent`
- `CopilotTextarea` → removed in v2
- `useCopilotReadable` → use `useAgentContext`
