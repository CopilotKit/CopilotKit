"""Switchable runtime factory for the lead-triage agent.

Selects one of three configurations based on `AGENT_RUNTIME` so we can
side-by-side benchmark Gemini-Flash-Lite-deepagents vs. Gemini-Flash-Lite-react
vs. Claude-Sonnet-4.6-react without a code edit.

Every runtime keeps the same middleware chain — `TimingMiddleware` first
(outermost) so it sees every inner model/tool call, then `LeadStateMiddleware`
to contribute the canvas-state TypedDict, and `CopilotKitMiddleware` for
AG-UI / CopilotKit interop.

Anthropic deps are imported lazily so a missing `ANTHROPIC_API_KEY` only
breaks the Claude runtime — the Gemini runtimes still boot.
"""

from __future__ import annotations

import os
from typing import Literal

from langgraph.graph.state import CompiledStateGraph

from copilotkit import CopilotKitMiddleware

from .lead_state import LeadStateMiddleware
from .timing import TimingMiddleware


RuntimeName = Literal[
    "gemini-flash-deep",
    "gemini-flash-react",
    "claude-sonnet-4-6-react",
    "noop",
]


_VALID_RUNTIMES = (
    "gemini-flash-deep",
    "gemini-flash-react",
    "claude-sonnet-4-6-react",
    "noop",
)


# Default message for the noop fallback runtime. Phrasing is verbatim from
# the phase-05 acceptance criteria: a missing GEMINI_API_KEY must surface a
# 3s reply with this text instead of hanging on "thinking…".
NOOP_FALLBACK_MESSAGE = (
    "Set `GEMINI_API_KEY` in agent/.env to enable the agent. "
    "The starter is otherwise fully wired and will work as soon as you add a key."
)


def build_graph(
    runtime: str,
    *,
    tools: list,
    system_prompt: str,
) -> CompiledStateGraph:
    """Compile a graph for the named runtime.

    Args:
        runtime: One of `gemini-flash-deep`, `gemini-flash-react`,
            `claude-sonnet-4-6-react`. Anything else falls back to
            `gemini-flash-deep` with a warning.
        tools: Notion-MCP-backed + local backend tools to bind. Frontend
            tools are forwarded by `CopilotKitMiddleware` at run time and
            must NOT appear here (Gemini rejects duplicate function
            declarations).
        system_prompt: Already-composed system prompt (with the integration
            status block from phase 01 baked in).
    """
    if runtime not in _VALID_RUNTIMES:
        print(
            f"[runtime] WARN: unknown AGENT_RUNTIME={runtime!r}; "
            f"falling back to gemini-flash-deep",
            flush=True,
        )
        runtime = "gemini-flash-deep"

    timing = TimingMiddleware()
    lead_state = LeadStateMiddleware()
    copilotkit = CopilotKitMiddleware()
    middleware = [timing, lead_state, copilotkit]

    if runtime == "noop":
        return _build_noop(NOOP_FALLBACK_MESSAGE)
    if runtime == "gemini-flash-deep":
        return _build_gemini_deep(tools, system_prompt, middleware)
    if runtime == "gemini-flash-react":
        return _build_gemini_react(tools, system_prompt, middleware)
    if runtime == "claude-sonnet-4-6-react":
        return _build_claude_react(tools, system_prompt, middleware)

    # Unreachable (validated above) — placate type-checker
    raise RuntimeError(f"unreachable runtime branch: {runtime!r}")


# ---------------------------------------------------------------------- noop

# Module-level state schema for the noop graph. Defined outside `_build_noop`
# so `get_type_hints(_NoopState)` can resolve the `Annotated[list,
# add_messages]` forward ref — function-local TypedDicts get evaluated with
# globals from `typing.py`, where `Annotated` isn't bound, and LangGraph
# raises `NameError: name 'Annotated' is not defined`.
from langgraph.graph.message import add_messages as _add_messages
from typing_extensions import Annotated as _Annotated, TypedDict as _TypedDict


class _NoopState(_TypedDict):
    messages: _Annotated[list, _add_messages]


def _build_noop(message: str) -> CompiledStateGraph:
    """Build a no-LLM fallback graph that always replies `message`.

    Used when GEMINI_API_KEY is missing or stub — instead of letting the
    real Gemini runtime boot and hang on the first turn with an opaque
    auth error, we register this graph so the chat answers in <1s with a
    pointer at the fix.

    Schema is minimal: just `messages` with the standard add_messages
    reducer so LangGraph's serializer is happy and CopilotKit's
    STATE_SNAPSHOT path doesn't choke. We deliberately don't include the
    canvas-state middleware here — the noop runtime is for the "user
    hasn't even configured the agent yet" path; there's no canvas state
    to thread through.
    """
    from langchain_core.messages import AIMessage
    from langgraph.graph import END, START, StateGraph

    def _respond(_state: _NoopState) -> dict:
        # Stable id keeps the message from being treated as a fresh
        # delivery on every tick — important if the agent gets re-invoked.
        return {"messages": [AIMessage(content=message, id="noop-fallback")]}

    graph = StateGraph(_NoopState)
    graph.add_node("respond", _respond)
    graph.add_edge(START, "respond")
    graph.add_edge("respond", END)
    return graph.compile()


# --------------------------------------------------------------------- gemini

def _gemini_llm():
    """Build the configured Gemini Flash-Lite chat model.

    Default: `gemini-3.1-flash-lite` — the high-volume workhorse in the
    Gemini 3 family. Verified against `langchain-google-genai` 2.x;
    swap the id here if you want `gemini-3-flash` or a future tier.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "stub"
    return ChatGoogleGenerativeAI(
        model="gemini-3.1-flash-lite",
        temperature=0,
        api_key=api_key,
    )


def _build_gemini_deep(
    tools: list, system_prompt: str, middleware: list
) -> CompiledStateGraph:
    """Default: Gemini Flash-Lite + deepagents planner.

    Note on recursion_limit: deepagents' `create_deep_agent` calls
    `.with_config({recursion_limit: 9_999})` internally, but the
    @ag-ui/langgraph adapter that the BFF uses opens runs against the
    LangGraph SDK with its own default (25). The fix lives at the BFF
    layer (`bff/src/server.ts` — `assistantConfig.recursion_limit`)
    because that's where the per-run config is actually composed; setting
    it here would only affect direct `graph.invoke()` paths, not the
    AG-UI runs the chat sidebar issues.
    """
    from deepagents import create_deep_agent

    llm = _gemini_llm()
    return create_deep_agent(
        model=llm,
        tools=tools,
        system_prompt=system_prompt,
        middleware=middleware,
    )


def _build_gemini_react(
    tools: list, system_prompt: str, middleware: list
) -> CompiledStateGraph:
    """Plain `create_agent` (the new react agent factory) on Gemini Flash-Lite.

    Skips deepagents' planner / virtual-fs / TODO-loop — we want to know how
    much of the per-turn latency is the planner versus the model itself.
    """
    from langchain.agents import create_agent

    llm = _gemini_llm()
    return create_agent(
        model=llm,
        tools=tools,
        system_prompt=system_prompt,
        middleware=middleware,
    )


# --------------------------------------------------------------------- claude

def _build_claude_react(
    tools: list, system_prompt: str, middleware: list
) -> CompiledStateGraph:
    """Claude Sonnet 4.6 (latest) on the same react factory."""
    # Lazy import so a missing langchain-anthropic install only surfaces
    # when this runtime is actually selected.
    from langchain.agents import create_agent
    from langchain_anthropic import ChatAnthropic

    api_key = os.getenv("ANTHROPIC_API_KEY") or ""
    if not api_key:
        print(
            "\n  ANTHROPIC_API_KEY is unset.\n"
            "   The agent will boot but the first chat turn will fail with an\n"
            "   auth error. Set ANTHROPIC_API_KEY in agent/.env.\n",
            flush=True,
        )

    # Sonnet 4.6 is the latest Sonnet 4 minor — DO NOT downgrade to 3.5.
    llm = ChatAnthropic(
        model="claude-sonnet-4-6",
        temperature=0,
        api_key=api_key or "stub",
    )
    return create_agent(
        model=llm,
        tools=tools,
        system_prompt=system_prompt,
        middleware=middleware,
    )
