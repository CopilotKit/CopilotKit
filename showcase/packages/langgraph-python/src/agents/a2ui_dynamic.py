"""
LangGraph agent for the Declarative Generative UI (A2UI) demo — canonical
"Bring Your Own Catalog" (BYOC) pattern.

This cell demonstrates the minimal A2UI integration as documented in the
CopilotKit A2UI docs:

- The runtime is wired with
  ``a2ui: { injectA2UITool: true, agents: ["declarative-gen-ui"] }``
  (see ``src/app/api/copilotkit/route.ts``), which auto-injects the
  A2UI ``render_a2ui`` tool + usage guidelines into the agent's tool list at
  request time. No tools are defined here.
- The frontend registers a custom catalog (Card / StatusBadge / Metric /
  InfoRow / PrimaryButton — see
  ``src/app/demos/declarative-gen-ui/a2ui/renderers.tsx``).
  The runtime's A2UI middleware injects that catalog's schema as
  ``copilotkit.context`` so the LLM knows which components + props it may
  emit.
- The agent itself is just a plain ``create_agent`` with
  ``CopilotKitMiddleware``; no secondary LLM, no tool binding, no
  ``bind_tools([render_a2ui])``.

Reference: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
"""

from __future__ import annotations

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI). "
    "Whenever a response would benefit from a rich visual — a dashboard, "
    "status report, KPI summary, card layout, info grid, or anything more "
    "structured than plain text — call the `render_a2ui` tool to draw it. "
    "Use ONLY the components listed in the catalog schema provided in your "
    "context (custom components such as Card, StatusBadge, Metric, InfoRow, "
    "PrimaryButton, plus the basic-catalog primitives Column, Row, Text, "
    "Image, …). Prefer Metric for numbers, StatusBadge for health/state, "
    "InfoRow for key/value facts, and Card as a container. Keep chat "
    "replies to one short sentence; let the UI do the talking."
)


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
