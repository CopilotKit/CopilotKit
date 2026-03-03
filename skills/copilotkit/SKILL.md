---
name: copilotkit
description: Single CopilotKit implementation skill with BuiltInAgent starter path and linked subtopic guides.
argument-hint: "<task>"
user-invocable: true
---

Use this skill for any CopilotKit implementation, debugging, migration, or architecture request.

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
- [Copilot Runtime](topic-copilot-runtime.md)
- [Agentic Chat UI](topic-agentic-chat-ui.md)
- [Frontend Actions](topic-frontend-actions.md)
- [Backend Actions](topic-backend-actions.md)
- [Shared State](topic-shared-state.md)
- [Human In The Loop](topic-human-in-the-loop.md)
- [Generative UI](topic-generative-ui.md)
- [Agentic Protocols](topic-agentic-protocols.md)
- [V2 API Reference](topic-reference-v2.md)
- [Troubleshooting](topic-troubleshooting.md)

## Partner Frameworks
Framework index: [Partner Frameworks Overview](partner-frameworks.md)

- [ADK](framework-adk.md)
- [A2A](framework-a2a.md)
- [Microsoft Agent Framework](framework-microsoft-agent-framework.md)
- [AWS Strands](framework-aws-strands.md)
- [Direct to LLM](framework-direct-to-llm.md)
- [LangGraph](framework-langgraph.md)
- [AG2](framework-ag2.md)
- [Agno](framework-agno.md)
- [CrewAI Crews](framework-crewai-crews.md)
- [CrewAI Flows](framework-crewai-flows.md)
- [LlamaIndex](framework-llamaindex.md)
- [Mastra](framework-mastra.md)
- [Open Agent Spec](framework-agent-spec.md)
- [Pydantic AI](framework-pydantic-ai.md)

## Navigation Hints
- Start with BuiltInAgent quickstart for generic requests.
- For framework-specific asks, jump directly to that framework doc.
- For architecture and cross-cutting concerns, use the major topic docs.
- Each linked guide includes route-level source pointers back to docs content.
