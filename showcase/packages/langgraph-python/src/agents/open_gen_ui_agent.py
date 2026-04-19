"""Minimal LangGraph agent for the Open-Ended Generative UI demo.

The simplest possible example that exercises the open-ended generative UI
pipeline. All the interesting work happens outside the agent:

- `CopilotKitMiddleware` merges the frontend-registered `generateSandboxedUi`
  tool (auto-registered by `CopilotKitProvider` when the runtime has
  `openGenerativeUI` enabled) into the agent's tool list. The LLM then sees
  the tool via the normal AG-UI flow.
- When the LLM calls `generateSandboxedUi`, the runtime's
  `OpenGenerativeUIMiddleware` (enabled via `openGenerativeUI` on the
  runtime — see `src/app/api/copilotkit-ogui/route.ts`) converts that
  streaming tool call into `open-generative-ui` activity events that the
  built-in renderer mounts inside a sandboxed iframe.

This is the minimal variant: no sandbox functions, no app-side tools. The
agent simply asks the LLM to design and emit a single-shot sandboxed UI.
The "advanced" sibling (`open_gen_ui_advanced_agent.py`) builds on this
with sandbox-to-host function calling via `openGenerativeUI.sandboxFunctions`.
"""

from __future__ import annotations

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


SYSTEM_PROMPT = """You are a UI-generating assistant for an Open Generative UI demo.

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. Design a visually polished, self-contained HTML + CSS
widget that answers the user's request — a greeting card, a calculator,
a chart (using Chart.js from a CDN), a timer, or anything else the user
asks for.

Generation guidance:
- Emit `initialHeight` and a short `placeholderMessages` array first.
- Then CSS (complete), then HTML (streams live so keep it tidy).
- Use CDN scripts (Chart.js, D3, etc.) via <script> tags in the HTML head
  when you need libraries. The sandbox CAN load external CDN resources.
- Do NOT use fetch/XHR, localStorage, or document.cookie — the sandbox has
  no same-origin access.
- Keep your own chat message brief (1 sentence max) since the real output
  is the rendered UI.
"""


graph = create_agent(
    model=ChatOpenAI(model="gpt-4.1", model_kwargs={"parallel_tool_calls": False}),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
