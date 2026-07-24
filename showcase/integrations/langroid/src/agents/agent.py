"""
Langroid AG-UI Agent

Wraps a Langroid ChatAgent with tools behind a custom AG-UI SSE endpoint.
Langroid does not have a native AG-UI adapter, so we implement the AG-UI
protocol (SSE events) manually using the ag-ui-protocol types.

The agent supports:
  - Agentic chat (streaming text responses)
  - Backend tool execution (get_weather, query_data, manage_sales_todos,
    get_sales_todos, search_flights, generate_a2ui)
  - Frontend tool calls (change_background, generate_haiku, schedule_meeting)
  - Human-in-the-loop via schedule_meeting (frontend-rendered meeting time picker)

NOTE ON DRIFT: This module is the canonical source. Starters are now
extracted on-demand from this integration directory via
``showcase/scripts/extract-starter.ts``.
Sibling provider-agnostic A2UI planner implementations live in
``showcase/integrations/google-adk/src/agents/main.py`` and
``showcase/integrations/strands/src/agents/agent.py`` — keep error shapes
aligned.
"""

# @region[weather-tool-backend]
from __future__ import annotations

import json
import logging
import os
from enum import Enum
from typing import Annotated, Any, Literal

# Module-local binding for json.dumps. Tests that need to inject
# serialization failures (RecursionError / MemoryError / etc.) patch THIS
# symbol instead of ``json.dumps``. Patching the stdlib attribute directly
# mutates the globally-shared module object and can collide with pytest /
# caplog internals that dispatch through ``json.dumps`` during the test
# — producing false failures that look like test-code bugs but are
# actually patch-leakage. The module-local binding is the only safe
# patch target.
_json_dumps = json.dumps

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# =====================================================================
# Shared tool implementations (symlinked at project root → ../../shared/python/tools)
# =====================================================================
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
)


# =====================================================================
# Langroid Tool Definitions
# =====================================================================


class _ToolErrorKind(str, Enum):
    """Closed set of backend-tool error codes.

    Using an Enum (str-valued so JSON serialization stays stable) keeps
    call sites from inventing new codes and defends against typos like
    ``"get_wether_failed"`` that ship silently through free-form strings.
    Values match the historical bare-string codes so the serialized JSON
    shape is identical to the previous contract.
    """

    GET_WEATHER_FAILED = "get_weather_failed"
    QUERY_DATA_FAILED = "query_data_failed"
    MANAGE_SALES_TODOS_FAILED = "manage_sales_todos_failed"
    GET_SALES_TODOS_FAILED = "get_sales_todos_failed"
    SCHEDULE_MEETING_FAILED = "schedule_meeting_failed"
    SEARCH_FLIGHTS_FAILED = "search_flights_failed"


def _tool_error(*, error: _ToolErrorKind, message: str) -> str:
    """Serialize a structured error that a tool ``handle()`` can return to
    langroid. Keeps the surface consistent across all backend tools so the
    outer LLM treats recoverable tool failures uniformly rather than seeing
    unstructured exception tracebacks.

    ``error`` is the ``_ToolErrorKind`` enum (not a raw string) so call
    sites cannot invent new error codes and bypass the closed set. The
    function extracts ``.value`` internally; callers pass the enum
    directly.
    """
    return _json_dumps({"error": error.value, "message": message})


class GetWeatherTool(ToolMessage):
    request: str = "get_weather"
    purpose: str = "Get current weather for a location."
    location: str

    def handle(self) -> str:
        try:
            result = get_weather_impl(self.location)
            return _json_dumps(result)
        except Exception as exc:  # noqa: BLE001 — tool errors must not escape
            logger.exception("GetWeatherTool.handle failed")
            return _tool_error(
                error=_ToolErrorKind.GET_WEATHER_FAILED,
                message=f"{exc.__class__.__name__}: {str(exc)[:200]}",
            )


# @endregion[weather-tool-backend]


class QueryDataTool(ToolMessage):
    request: str = "query_data"
    purpose: str = "Query the database. Always call before showing a chart or graph."
    query: str

    def handle(self) -> str:
        try:
            result = query_data_impl(self.query)
            return _json_dumps(result)
        except Exception as exc:  # noqa: BLE001
            logger.exception("QueryDataTool.handle failed")
            return _tool_error(
                error=_ToolErrorKind.QUERY_DATA_FAILED,
                message=f"{exc.__class__.__name__}: {str(exc)[:200]}",
            )


class ManageSalesTodosTool(ToolMessage):
    request: str = "manage_sales_todos"
    purpose: str = (
        "Replace the entire list of sales todos with the provided values. "
        "Always include every todo you want to keep."
    )
    todos: list[dict]

    def handle(self) -> str:
        try:
            result = manage_sales_todos_impl(self.todos)
            return _json_dumps(result)
        except Exception as exc:  # noqa: BLE001
            logger.exception("ManageSalesTodosTool.handle failed")
            return _tool_error(
                error=_ToolErrorKind.MANAGE_SALES_TODOS_FAILED,
                message=f"{exc.__class__.__name__}: {str(exc)[:200]}",
            )


class GetSalesTodosTool(ToolMessage):
    request: str = "get_sales_todos"
    purpose: str = "Get the current list of sales todos."

    def handle(self) -> str:
        try:
            result = get_sales_todos_impl()
            return _json_dumps(result)
        except Exception as exc:  # noqa: BLE001
            logger.exception("GetSalesTodosTool.handle failed")
            return _tool_error(
                error=_ToolErrorKind.GET_SALES_TODOS_FAILED,
                message=f"{exc.__class__.__name__}: {str(exc)[:200]}",
            )


# Frontend tools — the agent "calls" them but they execute client-side.
# We define them so Langroid's LLM knows the tool schemas; the AG-UI
# adapter intercepts the call and forwards it to the frontend.


class ChangeBackgroundTool(ToolMessage):
    request: str = "change_background"
    purpose: str = "Change the background color/gradient of the chat area. ONLY call this when the user explicitly asks."
    background: Annotated[str, "CSS background value. Prefer gradients."]

    def handle(self) -> str:
        # Frontend tool: the AG-UI adapter normally intercepts the call and
        # routes it to the client before this handler runs. If we're here,
        # the routing regressed and the agent is about to lie to the user
        # about an action it never performed. Log loudly so the regression
        # surfaces in server logs. We still return the benign string to
        # preserve the existing non-breaking contract for starters.
        logger.error(
            "ChangeBackgroundTool.handle fired server-side — AG-UI adapter "
            "dispatch regression; frontend tool was not intercepted"
        )
        return f"Background changed to {self.background}"


class GenerateHaikuTool(ToolMessage):
    request: str = "generate_haiku"
    purpose: str = "Generate a haiku with Japanese text, English translation, and a background image."
    japanese: list[str]
    english: list[str]
    image_name: str
    gradient: str

    def handle(self) -> str:
        # Frontend tool — see ChangeBackgroundTool.handle for rationale on
        # logging vs raising.
        logger.error(
            "GenerateHaikuTool.handle fired server-side — AG-UI adapter "
            "dispatch regression; frontend tool was not intercepted"
        )
        return "Haiku generated!"


# @region[backend-interrupt-tool]
# @region[backend-tool-call]
# `schedule_meeting` is declared here as a `ToolMessage` subclass so Langroid's
# LLM knows the tool's schema, but it executes client-side: the AG-UI adapter
# intercepts the call and forwards it to the frontend's `useFrontendTool`
# handler, which renders the time picker and resolves a Promise with the
# user's choice. `handle()` only runs if that interception regresses.
class ScheduleMeetingTool(ToolMessage):
    request: str = "schedule_meeting"
    purpose: str = "Schedule a meeting. The user will be asked to pick a time via the meeting time picker UI."
    reason: str
    duration_minutes: int = 30

    def handle(self) -> str:
        try:
            result = schedule_meeting_impl(self.reason, self.duration_minutes)
            return _json_dumps(result)
        except Exception as exc:  # noqa: BLE001
            logger.exception("ScheduleMeetingTool.handle failed")
            return _tool_error(
                error=_ToolErrorKind.SCHEDULE_MEETING_FAILED,
                message=f"{exc.__class__.__name__}: {str(exc)[:200]}",
            )


# @endregion[backend-tool-call]
# @endregion[backend-interrupt-tool]


class SearchFlightsTool(ToolMessage):
    request: str = "search_flights"
    purpose: str = (
        "Search for flights and display the results as rich cards. Return exactly 2 flights. "
        "Each flight must have: airline, airlineLogo, flightNumber, origin, destination, "
        "date, departureTime, arrivalTime, duration, status, statusColor, price, currency."
    )
    flights: list[dict]

    def handle(self) -> str:
        try:
            result = search_flights_impl(self.flights)
            return _json_dumps(result)
        except Exception as exc:  # noqa: BLE001
            logger.exception("SearchFlightsTool.handle failed")
            return _tool_error(
                error=_ToolErrorKind.SEARCH_FLIGHTS_FAILED,
                message=f"{exc.__class__.__name__}: {str(exc)[:200]}",
            )


class GenerateA2UITool(ToolMessage):
    request: str = "generate_a2ui"
    purpose: str = (
        "Generate dynamic A2UI components based on the conversation context. "
        "Call with no arguments — the CopilotKit runtime middleware intercepts "
        "this call and drives the render_a2ui design pass itself (Option A: "
        "JS-injected A2UI). If handle() fires, the middleware interception "
        "regressed."
    )

    def handle(self) -> str:
        # Option A: the CopilotKit runtime A2UIMiddleware should intercept
        # generate_a2ui BEFORE it reaches the Python backend and drive the
        # secondary render_a2ui LLM pass itself. If we are here, the
        # middleware interception regressed. Log loudly so the regression
        # surfaces in server logs.
        logger.error(
            "GenerateA2UITool.handle fired server-side — A2UIMiddleware "
            "interception regression; generate_a2ui should be intercepted "
            "by the JS runtime before reaching Python."
        )
        return _json_dumps(
            {"error": "generate_a2ui reached Python backend (middleware regression)"}
        )


# Tools that execute server-side (Langroid handles them directly)
BACKEND_TOOLS: tuple[type[ToolMessage], ...] = (
    GetWeatherTool,
    QueryDataTool,
    ManageSalesTodosTool,
    GetSalesTodosTool,
    SearchFlightsTool,
    GenerateA2UITool,
)

# Tools that execute client-side (AG-UI adapter forwards to frontend)
FRONTEND_TOOLS: tuple[type[ToolMessage], ...] = (
    ChangeBackgroundTool,
    GenerateHaikuTool,
    ScheduleMeetingTool,
)

ALL_TOOLS: tuple[type[ToolMessage], ...] = BACKEND_TOOLS + FRONTEND_TOOLS

FRONTEND_TOOL_NAMES: frozenset[str] = frozenset(
    t.default_value("request") for t in FRONTEND_TOOLS
)

# Canary: the set of frontend tool names is part of the contract with the
# AG-UI adapter (which looks them up to route execution to the client).
# If a tool is added/removed/renamed without updating the adapter, this
# raises at import time rather than at request time.
#
# Uses ``raise RuntimeError`` (not ``assert``) so ``python -O`` can't strip
# the check in production.
_EXPECTED_FRONTEND_TOOL_NAMES = frozenset(
    {"change_background", "generate_haiku", "schedule_meeting"}
)
if FRONTEND_TOOL_NAMES != _EXPECTED_FRONTEND_TOOL_NAMES:
    raise RuntimeError(
        f"FRONTEND_TOOL_NAMES drifted: {FRONTEND_TOOL_NAMES!r} "
        f"(expected {_EXPECTED_FRONTEND_TOOL_NAMES!r})"
    )

SYSTEM_PROMPT = (
    "You are a polished, professional demo assistant for CopilotKit. "
    "Keep responses brief and clear -- 1 to 2 sentences max.\n\n"
    "You can:\n"
    "- Chat naturally with the user\n"
    "- Change the UI background when asked (via frontend tool)\n"
    "- Query data and render charts (via query_data tool)\n"
    "- Get weather information (via get_weather tool)\n"
    "- Schedule meetings with the user (via schedule_meeting tool -- the user picks a time in the UI)\n"
    "- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)\n"
    "- Search flights and display rich A2UI cards (via search_flights tool)\n"
    "- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)\n"
    "- Generate step-by-step plans for user review (human-in-the-loop)\n"
    "When asked about weather, always use the get_weather tool. "
    "When asked about data, charts, or graphs, use the query_data tool first."
)


# =====================================================================
# Agent factory
# =====================================================================


def create_agent(system_message: str | None = None) -> lr.ChatAgent:
    """Create a Langroid ChatAgent configured with all showcase tools.

    Default model is the bare ``gpt-4.1`` (not ``openai/gpt-4.1``): langroid
    does NOT strip the ``openai/`` prefix before passing the string to the
    OpenAI SDK, and the SDK rejects ``openai/gpt-4.1`` as "model not found".

    ``system_message`` — optional override for the agent's system prompt.
    Used by the Agent Config Object demo to steer tone / expertise /
    responseLength per request. When ``None`` (the default), the canonical
    ``SYSTEM_PROMPT`` is used so behavior for every other demo is
    unchanged.
    """
    model = os.getenv("LANGROID_MODEL", "gpt-4.1")

    llm_config = lm.OpenAIGPTConfig(
        chat_model=model,
        stream=True,
    )

    agent_config = lr.ChatAgentConfig(
        llm=llm_config,
        system_message=system_message or SYSTEM_PROMPT,
    )

    agent = lr.ChatAgent(agent_config)
    agent.enable_message(list(ALL_TOOLS))
    return agent


# =====================================================================
# Agent-config demo — dynamic system-prompt construction
# =====================================================================
#
# The /demos/agent-config cell lets the user pick ``tone`` / ``expertise`` /
# ``responseLength`` in a config card; those values arrive as frontend
# ``properties`` and are forwarded by the Next.js runtime on the AG-UI
# ``forwardedProps`` field. The dedicated TS route at
# ``src/app/api/copilotkit-agent-config/route.ts`` repacks them into
# ``forwardedProps.config.configurable.properties`` (mirroring the upstream
# langgraph-python shape) so the backend reads them from a single
# deterministic location regardless of which showcase adapter is
# forwarding the request.
#
# Kept close to ``SYSTEM_PROMPT`` so the tool-list copy stays in sync.


# Valid values — silently ignore anything else instead of blowing up a
# turn on a frontend bug. The page's <CopilotKit properties={...}> is the
# source of truth, but an operator running the backend against a
# customized frontend (or a bad test fixture) should see "prompt not
# steered" not "500 from the agent".
_AGENT_CONFIG_TONES: frozenset[str] = frozenset(
    {"professional", "casual", "enthusiastic"}
)
_AGENT_CONFIG_EXPERTISE: frozenset[str] = frozenset(
    {"beginner", "intermediate", "expert"}
)
_AGENT_CONFIG_LENGTHS: frozenset[str] = frozenset({"concise", "detailed"})


_TONE_DIRECTIVES: dict[str, str] = {
    "professional": "Use a polished, professional tone.",
    "casual": "Use a casual, conversational tone.",
    "enthusiastic": "Use an enthusiastic, upbeat tone with warmth.",
}

_EXPERTISE_DIRECTIVES: dict[str, str] = {
    "beginner": (
        "Assume the user is a beginner: explain concepts step by step, "
        "avoid jargon, and define any technical term the first time it "
        "appears."
    ),
    "intermediate": (
        "Assume the user has intermediate familiarity with the topic: "
        "you can use common domain terminology without defining every "
        "term, but still briefly frame non-obvious concepts."
    ),
    "expert": (
        "Assume the user is an expert: be precise, use domain-specific "
        "terminology freely, and skip introductory framing."
    ),
}

_LENGTH_DIRECTIVES: dict[str, str] = {
    "concise": "Keep responses brief — 1 to 2 sentences max.",
    "detailed": (
        "Provide a detailed response — multiple sentences or a short "
        "paragraph, with enough context for the user to act on it."
    ),
}


def build_agent_config_system_prompt(
    *,
    tone: str | None,
    expertise: str | None,
    response_length: str | None,
) -> str:
    """Build a dynamic system prompt for the agent-config demo.

    Appends tone / expertise / length directives to the canonical
    ``SYSTEM_PROMPT`` so the agent keeps the same tool repertoire and demo
    persona but adopts the user-selected style. Unknown values (including
    ``None``) are skipped silently so a partial set of forwarded
    properties still produces a usable prompt.
    """
    directives: list[str] = []
    if tone in _AGENT_CONFIG_TONES:
        directives.append(_TONE_DIRECTIVES[tone])
    if expertise in _AGENT_CONFIG_EXPERTISE:
        directives.append(_EXPERTISE_DIRECTIVES[expertise])
    if response_length in _AGENT_CONFIG_LENGTHS:
        directives.append(_LENGTH_DIRECTIVES[response_length])

    if not directives:
        return SYSTEM_PROMPT

    return SYSTEM_PROMPT + "\n\nUser-selected style:\n- " + "\n- ".join(directives)


def extract_agent_config_properties(
    forwarded_props: Any,
) -> dict[str, str] | None:
    """Pull ``{tone, expertise, responseLength}`` out of AG-UI forwardedProps.

    Accepts two shapes and merges them (flat keys win for the keys they
    define, but ``config.configurable.properties`` is the canonical
    location):

    1. The canonical location — ``forwarded_props.config.configurable.properties``
       — which is where the dedicated Next.js route repacks provider
       properties.
    2. Flat top-level keys on ``forwarded_props`` — a defensive fallback
       in case a future runtime bypasses the repack step.

    Returns ``None`` when none of the three keys are present, so callers
    can trivially tell "no agent-config steering requested" from
    "explicitly requested but with empty strings".
    """
    if not isinstance(forwarded_props, dict):
        return None

    # Start with the canonical location.
    merged: dict[str, str] = {}
    config = forwarded_props.get("config")
    if isinstance(config, dict):
        configurable = config.get("configurable")
        if isinstance(configurable, dict):
            properties = configurable.get("properties")
            if isinstance(properties, dict):
                for key in ("tone", "expertise", "responseLength"):
                    value = properties.get(key)
                    if isinstance(value, str) and value:
                        merged[key] = value

    # Flat-key fallback — only fills in keys the canonical location
    # didn't provide, so the repacked location stays authoritative.
    for key in ("tone", "expertise", "responseLength"):
        if key in merged:
            continue
        value = forwarded_props.get(key)
        if isinstance(value, str) and value:
            merged[key] = value

    if not merged:
        return None
    return merged
