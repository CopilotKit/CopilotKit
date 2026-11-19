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
agent asks Claude to answer a one-off question with a single custom visual
report rendered as sandboxed HTML.
The "advanced" sibling (`open_gen_ui_advanced_agent.py`) builds on this
with sandbox-to-host function calling via `openGenerativeUI.sandboxFunctions`.
"""

from __future__ import annotations

from typing import Any, Callable

from copilotkit import CopilotKitMiddleware
from copilotkit.header_propagation import install_httpx_hook
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_anthropic import ChatAnthropic


SYSTEM_PROMPT = """You build one-off visual reports. The user asks a specific \
business question; you answer it with a single custom report rendered as HTML, \
the way an analyst would hand over a polished one-page artifact.

Call the `generateSandboxedUi` tool exactly once per user turn. The frontend \
injects a design skill describing layout, palette, and chart conventions as \
agent context; follow it.

There is no data source connected to this demo. Invent a small, internally \
consistent, realistic dataset for the question (totals must add up, trends \
must match the numbers shown) and label the report "Sample data" in its \
subtitle. Never imply the numbers are real.

Order the HTML so it reads well while it streams: title and the headline \
answer first, then KPI tiles, then charts, then the detail table or examples. \
Draw charts as inline SVG; do not load external scripts.

After the tool call, reply with one short sentence. The report is the answer."""


class _ClaudeToolStreamingMiddleware(AgentMiddleware):
    """Makes the frontend `generateSandboxedUi` tool stream on Claude.

    `CopilotKitMiddleware` (which runs first) merges the frontend tools in as
    OpenAI-style dicts. Converting them to Anthropic tool dicts lets us set
    `eager_input_streaming`, so the HTML argument streams token by token
    instead of arriving in one burst at the end, which is what lets the
    sandboxed iframe render progressively.

    It also installs CopilotKit's header-forwarding hook on the Anthropic
    clients: `CopilotKitMiddleware` only looks for `client` / `async_client`
    attributes, which `ChatAnthropic` names `_client` / `_async_client`, so
    without this the x-aimock-* test headers would not reach aimock.
    """

    def _prepare(self, request: ModelRequest) -> ModelRequest:
        for attr in ("_client", "_async_client"):
            client = getattr(request.model, attr, None)
            if client is not None:
                install_httpx_hook(client)

        tools: list[Any] = []
        for tool in request.tools:
            fn = tool.get("function") if isinstance(tool, dict) else None
            if isinstance(fn, dict) and fn.get("name"):
                tools.append(
                    {
                        "name": fn["name"],
                        "description": fn.get("description", ""),
                        "input_schema": fn.get("parameters")
                        or {"type": "object", "properties": {}},
                        "eager_input_streaming": True,
                    }
                )
            else:
                tools.append(tool)
        return request.override(tools=tools)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._prepare(request))

    async def awrap_model_call(
        self, request: ModelRequest, handler: Any
    ) -> ModelResponse:
        return await handler(self._prepare(request))


graph = create_agent(
    # Claude Opus 5.5 at low effort: it still plans the layout (thinking is
    # always on for this model) but keeps the time to first visible UI short.
    # Requires ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL when routed via aimock).
    model=ChatAnthropic(
        model="claude-opus-5-5",
        effort="low",
        max_tokens=32000,
        streaming=True,
    ),
    tools=[],
    # Order matters: CopilotKitMiddleware merges the frontend tools first,
    # then _ClaudeToolStreamingMiddleware converts them for Anthropic.
    middleware=[CopilotKitMiddleware(), _ClaudeToolStreamingMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
