---
name: copilotkit
description: Implements CopilotKit apps — runtime setup, agent integration, frontend tools, shared state, generative UI. Use when building with CopilotKit, LangGraph, CrewAI, Mastra, Pydantic AI, or any supported agent framework.
argument-hint: "<task>"
user-invocable: true
---

Use this skill for any CopilotKit implementation, debugging, or architecture request.

## Default Path: Build A Basic CopilotKit App (BuiltInAgent)

Follow this path first unless the user explicitly asks for a specific framework:
1. Create runtime endpoint with `CopilotRuntime` and `BuiltInAgent`.
2. Register the agent as `default` in runtime config.
3. Wrap the app with `<CopilotKit runtimeUrl="/api/copilotkit">`.
4. Add `CopilotSidebar` (or `CopilotChat`) to the page.
5. Verify end-to-end request flow before adding advanced features.

Use [BuiltInAgent Quickstart](built-in-agent-quickstart.md) for the full code scaffold and checklist.

## Major Topics
- [BuiltInAgent Quickstart](built-in-agent-quickstart.md)
- [Backend](topic-backend.md)
- [Agentic Chat UI](topic-agentic-chat-ui.md)
- [Frontend Tools](topic-frontend-tools.md)
- [Shared State](topic-shared-state.md)
- [Human In The Loop](topic-human-in-the-loop.md)
- [Generative UI](topic-generative-ui.md)
- [Agentic Protocols](topic-agentic-protocols.md)
- [API Reference](topic-api-reference.md)
- [Troubleshooting](topic-troubleshooting.md)

## Partner Frameworks
Framework index: [Partner Frameworks Overview](partner-frameworks.md)

- [Built In Agent](framework-built-in-agent.md)
- **LangGraph**: [Core Setup](framework-langgraph-core.md) · [Features & Capabilities](framework-langgraph-features.md) · [Troubleshooting & Ops](framework-langgraph-troubleshooting.md)
- [ADK](framework-adk.md)
- **Microsoft Agent Framework**: [Core Setup](framework-microsoft-agent-framework-core.md) · [Features & Capabilities](framework-microsoft-agent-framework-features.md)
- [AWS Strands](framework-aws-strands.md)
- [Mastra](framework-mastra.md)
- [Pydantic AI](framework-pydantic-ai.md)
- [CrewAI Flows](framework-crewai-flows.md)
- [Agno](framework-agno.md)
- [AG2](framework-ag2.md)
- [Open Agent Spec](framework-agent-spec.md)
- [LlamaIndex](framework-llamaindex.md)
- [A2A](framework-a2a.md)

## Navigation Hints
- Start with BuiltInAgent quickstart for generic requests.
- For framework-specific asks, jump directly to that framework doc.
- For architecture and cross-cutting concerns, use the major topic docs.
- Each linked guide includes route-level source pointers back to docs content.
