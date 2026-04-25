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

NOTE ON DRIFT: This module is the canonical source. The starter copy at
``showcase/starters/langroid/agent/agent.py`` is regenerated from this file
by ``showcase/scripts/generate-starters.ts``, which strips the shared-tools
path-injection block below (together with any now-unused stdlib imports it
relied on) and rewrites ``from tools import ...`` into ``from .tools
import ...`` — a single relative import against the starter's bundled
``agent/tools/`` package; no legacy fallback path is emitted. Any fix
must land in BOTH files until the generator is re-run.
Sibling provider-agnostic A2UI planner implementations live in
``showcase/packages/google-adk/src/agents/main.py`` and
``showcase/packages/strands/src/agents/agent.py`` — keep error shapes
aligned.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import sys
from enum import Enum
from typing import Annotated, Any, Literal, Protocol, TypedDict, cast

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
from pydantic import ValidationError
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# =====================================================================
# Shared tool implementations
# =====================================================================

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)


# =====================================================================
# A2UI planner LLM — provider-agnostic
# =====================================================================
#
# The secondary LLM that emits the A2UI schema is routed through langroid's
# own LLM abstraction (``lm.OpenAIGPT``, which despite the historical name
# handles OpenAI / Anthropic / Gemini / any ``provider/model`` chat-model
# string). That way this package stays provider-agnostic: whatever
# ``LANGROID_MODEL`` the operator picks for the primary chat agent, the A2UI
# planner inherits by default. Operators can override only the planner via
# ``A2UI_MODEL`` without touching the primary agent.
#
# Sibling implementations live in
# ``showcase/packages/google-adk/src/agents/main.py`` (Gemini-native) and
# ``showcase/packages/strands/src/agents/agent.py`` (OpenAI-only). Keep the
# error-surface shape (_A2uiError) consistent across all three so the
# frontend renderer treats them identically.


class _A2uiErrorKind(str, Enum):
    """Closed set of known A2UI planner error kinds.

    Using an Enum (str-valued so JSON serialization stays stable) lets us
    catch typos at static-analysis time and gives tests a single place to
    enumerate the valid set. Kept as ``str``-subclass so the serialized
    JSON shape is identical to the previous bare-string contract.
    """

    LLM_ERROR = "a2ui_llm_error"
    NO_TOOL_CALL = "a2ui_no_tool_call"
    INVALID_ARGUMENTS = "a2ui_invalid_arguments"


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Every error branch MUST populate all three keys so callers (and the LLM
    summarizing the tool result) see a consistent surface.

    NOTE: Identical TypedDicts live in
    ``showcase/packages/google-adk/src/agents/main.py`` and
    ``showcase/packages/strands/src/agents/agent.py``. Keep all three in
    sync — any key additions / removals must land in every sibling so the
    A2UI error surface stays consistent across showcase adapters.
    """

    # Synthesized from ``_A2uiErrorKind`` (Python 3.11+ ``Literal[*tuple(...)]``
    # unpacking) so the Literal and the enum can never drift out of sync.
    # Add/remove a kind in the enum above and the TypedDict follows automatically.
    error: Literal[*tuple(k.value for k in _A2uiErrorKind)]  # type: ignore[misc]
    message: str
    remediation: str


class _A2uiSuccess(TypedDict):
    """Shape of the successful generate_a2ui return value.

    Mirrors what ``build_a2ui_operations_from_tool_call`` produces: a single
    key ``a2ui_operations`` mapping to a list of operation dicts. Defining
    the shape here (rather than ``dict[str, Any]``) lets type-checkers flag
    accidental key renames and keeps the public contract documented next to
    the error surface.
    """

    a2ui_operations: list[dict[str, Any]]


def _a2ui_error(
    *, error: _A2uiErrorKind, message: str, remediation: str
) -> _A2uiError:
    """Construct and contract-check an ``_A2uiError``.

    Centralizing construction lets us enforce at runtime that every error
    return from the A2UI planner carries all three required keys with
    non-empty string values. Typos ("remediaton") or accidental omissions
    blow up here rather than silently produce a malformed error surface.

    ``error`` is the ``_A2uiErrorKind`` enum (not a raw string) so call sites
    cannot invent new error codes and bypass the closed set. The factory
    extracts ``.value`` internally; callers pass the enum directly.

    Raises ``ValueError`` (not ``assert``) so ``python -O`` can't strip the
    validation in production. Also rejects non-string values for
    ``message`` / ``remediation`` — the TypedDict annotation says ``str``
    and runtime must match, otherwise callers can accidentally slip lists
    or dicts through and break the frontend contract.
    """
    err: _A2uiError = {
        "error": error.value,
        "message": message,
        "remediation": remediation,
    }
    missing = [k for k in ("error", "message", "remediation") if not err.get(k)]
    if missing:
        raise ValueError(
            f"_a2ui_error missing required non-empty keys: {missing}; got {err!r}"
        )
    bad_types = [
        k for k in ("error", "message", "remediation") if not isinstance(err[k], str)
    ]
    if bad_types:
        raise ValueError(
            f"_a2ui_error requires str values for keys {bad_types}; got {err!r}"
        )
    return err


def _resolve_a2ui_model() -> str:
    """Resolve the A2UI planner's chat_model string.

    Resolution order:
      1. ``A2UI_MODEL`` — planner-only override.
      2. ``LANGROID_MODEL`` — inherits from the primary agent's model.
      3. Default ``gpt-4.1`` (bare OpenAI name — matches ``create_agent``
         below). NOTE: langroid does NOT strip the ``openai/`` prefix —
         it passes the model string LITERALLY to the OpenAI SDK, which
         rejects ``openai/gpt-4.1`` as "model not found". The canonical
         langroid convention (and ``OpenAIChatModel.GPT4_1.value``) is
         the bare name.
    """
    return (
        os.getenv("A2UI_MODEL")
        or os.getenv("LANGROID_MODEL")
        or "gpt-4.1"
    )


# Memoize the A2UI planner LLM so we don't rebuild ``OpenAIGPT`` (and re-run
# credential resolution) on every request. Keyed on the resolved model string
# so env overrides produce distinct entries. ``maxsize=4`` is intentional: in
# production the resolved model is effectively constant, so the cache only
# needs to cover test churn — tests that patch across more distinct models
# should call ``_get_a2ui_llm.cache_clear()`` rather than rely on identity.
@functools.lru_cache(maxsize=4)
def _get_a2ui_llm(model: str) -> lm.OpenAIGPT:
    """Return a memoized langroid LLM bound to the given chat_model string.

    Callers must resolve the model first (see ``_resolve_a2ui_model``) and
    pass it in explicitly; the cache is keyed on ``model`` so env changes
    produce distinct instances rather than silently returning a stale one.
    ``maxsize=4`` — the 5th distinct model evicts the least-recently-used
    entry (see block comment above for rationale). Call ``.cache_clear()``
    in tests that need to reset memoization.
    """
    config = lm.OpenAIGPTConfig(
        chat_model=model,
        # Non-streaming for the planner: we need the full tool call before
        # we can emit operations. Streaming here is wasted work.
        stream=False,
    )
    return lm.OpenAIGPT(config)


# The render_a2ui function the planner is forced to call. Kept here (not
# imported from shared/) because the shape is OpenAI-compatible regardless
# of which provider langroid's ``OpenAIGPT`` is talking to — langroid
# normalizes the forced-function-call across providers.
_RENDER_A2UI_FUNCTION_SPEC = lm.LLMFunctionSpec(
    name="render_a2ui",
    description="Render a dynamic A2UI v0.9 surface.",
    parameters={
        "type": "object",
        "properties": {
            "surfaceId": {"type": "string"},
            "catalogId": {"type": "string"},
            "components": {"type": "array", "items": {"type": "object"}},
            "data": {"type": "object"},
        },
        "required": ["surfaceId", "catalogId", "components"],
    },
)


class _LLMResponseLike(Protocol):
    """Structural type for the subset of ``LLMResponse`` we read.

    Defined as a Protocol (rather than importing langroid's concrete type)
    so the extractor is trivially unit-testable with a fake object and the
    signature documents exactly which attributes matter.
    """

    oai_tool_calls: Any
    function_call: Any


# Sentinel: distinct from ``None`` so the caller can tell "no tool call at all"
# (returned as ``None``) from "tool-call shape present but ``arguments`` field
# was ``None``" (returned as this sentinel). The two cases have different
# remediations — see ``generate_a2ui_via_llm``.
_ARGS_MISSING: object = object()


def _extract_tool_call_arguments(
    response: _LLMResponseLike,
) -> dict[str, Any] | str | None | object:
    """Pull the planner's tool-call arguments out of an ``LLMResponse``.

    Handles both shapes langroid exposes:
      - ``oai_tool_calls[0].function.arguments`` — modern tool-calling path.
      - ``function_call.arguments`` — legacy path used by some providers.

    Returns:
      - ``dict`` or ``str`` (JSON) — the raw arguments value to parse/use.
      - ``None`` — no tool call was produced at all (→ ``a2ui_no_tool_call``).
      - ``_ARGS_MISSING`` — a tool-call slot was present but its ``arguments``
        field was missing/None (→ ``a2ui_invalid_arguments``; the planner
        DID try to call but emitted a degraded shape, so "no tool call"
        remediation would be misleading).

    Logs a WARN for every shape-drift case so operators can diagnose
    langroid / provider-SDK regressions without strace-ing tests.
    """
    tool_calls = getattr(response, "oai_tool_calls", None)
    saw_modern_call = False
    if tool_calls:
        # Non-empty ``tool_calls`` list always counts as "planner attempted
        # a modern-slot call" — even when ``.function`` is None (degraded
        # shape). Without this, ``.function is None`` + no legacy
        # ``function_call`` returns plain ``None``, which the caller maps
        # to ``NO_TOOL_CALL``. But the planner DID try to call in the
        # modern slot; the correct remediation is ``INVALID_ARGUMENTS``
        # (symmetric with the ``.function.arguments is None`` case below).
        saw_modern_call = True
        if len(tool_calls) > 1:
            # Forced function-call should produce exactly one tool call;
            # multiple is unexpected and we pick index 0 silently today.
            # Logging it makes the truncation visible rather than mysterious.
            logger.warning(
                "generate_a2ui_via_llm: planner returned %d tool calls; "
                "using index 0 only",
                len(tool_calls),
            )
        first = tool_calls[0]
        func = getattr(first, "function", None)
        if func is not None:
            args = getattr(func, "arguments", None)
            if args is not None:
                return args
            # Degraded shape: the modern slot has no arguments. Log and
            # fall through to the legacy function_call path — providers
            # occasionally put the forced call in the legacy slot even
            # when the modern slot is present but empty.
            logger.warning(
                "generate_a2ui_via_llm: tool_call.function present but "
                ".arguments is None (response-shape drift?)"
            )
        else:
            # Degraded shape: tool_calls[0].function is None. Log and fall
            # through to the legacy function_call path — some providers put
            # the forced call in the legacy slot.
            logger.warning(
                "generate_a2ui_via_llm: tool_call present but .function is None "
                "(response-shape drift?)"
            )

    function_call = getattr(response, "function_call", None)
    if function_call is not None:
        args = getattr(function_call, "arguments", None)
        if args is None:
            # Legacy slot is present but its ``arguments`` field is missing.
            # Symmetric with the modern-slot warning above, and flagged as
            # INVALID_ARGUMENTS (not NO_TOOL_CALL) via the sentinel so the
            # caller emits the correct remediation.
            logger.warning(
                "generate_a2ui_via_llm: function_call present but .arguments "
                "is None (response-shape drift?)"
            )
            return _ARGS_MISSING
        return args

    # No legacy slot. If we saw a modern tool-call structure but its
    # arguments were empty, surface that as _ARGS_MISSING so the caller
    # emits a2ui_invalid_arguments rather than a2ui_no_tool_call.
    if saw_modern_call:
        return _ARGS_MISSING

    return None


def generate_a2ui_via_llm(*, context: str) -> _A2uiError | _A2uiSuccess:
    """Run the A2UI planner LLM and return either operations or a structured
    error.

    Provider-agnostic: routes through ``lm.OpenAIGPT`` (langroid's universal
    LLM abstraction) so whatever provider the operator configured via
    ``LANGROID_MODEL`` / ``A2UI_MODEL`` is used. No direct provider-SDK
    imports live in this module.

    Error surface is the shared ``_A2uiError`` TypedDict (see sibling
    google-adk / strands implementations).
    """
    system_prompt = context or "Generate a useful dashboard UI."
    messages = [
        lm.LLMMessage(role=lm.Role.SYSTEM, content=system_prompt),
        lm.LLMMessage(
            role=lm.Role.USER,
            content="Generate a dynamic A2UI dashboard based on the conversation.",
        ),
    ]

    # Wrap the LLM call so expected transport / auth / rate-limit failures
    # do not bubble up through langroid's tool machinery as uncaught
    # exceptions.
    #
    # We explicitly re-raise the narrow class of structural / programmer
    # bugs (AttributeError, TypeError, NameError, ImportError,
    # ModuleNotFoundError, AssertionError, NotImplementedError,
    # pydantic.ValidationError). Those indicate real bugs and must surface
    # to tests and server logs rather than be reported as "verify provider
    # credentials" — the remediation in ``a2ui_llm_error`` is wrong for
    # those classes (e.g. a missing ``anthropic`` package is an install
    # problem, not a credentials problem; a pydantic validation failure is
    # a schema bug, not a transport failure).
    #
    # Intentionally NOT re-raised (so they flow into the transport-error
    # path): KeyError, IndexError, LookupError, RecursionError, MemoryError.
    # The SDK / adapter stack raises these as recoverable conditions on
    # malformed provider payloads, and swallowing them into the structured
    # error surface gives callers the correct "retry / check provider"
    # remediation rather than an uncaught 500.
    try:
        llm = _get_a2ui_llm(_resolve_a2ui_model())
        response = llm.chat(
            messages=messages,
            functions=[_RENDER_A2UI_FUNCTION_SPEC],
            function_call={"name": "render_a2ui"},
        )
    except (
        AttributeError,
        TypeError,
        NameError,
        ImportError,
        ModuleNotFoundError,
        AssertionError,
        NotImplementedError,
        ValidationError,
    ):
        # Programmer / environment bugs — propagate so tests & server logs
        # catch them instead of producing a misleading "verify credentials"
        # remediation.
        raise
    except Exception as exc:  # noqa: BLE001 — see rationale above
        logger.exception("generate_a2ui_via_llm: LLM call failed")
        # Include a truncated str(exc) so ConnectionError("backend unreachable")
        # and similar transport failures surface the actionable substring.
        # We truncate regardless of provider SDK behavior — bounds the blast
        # radius of any future regression where an SDK embeds credentials
        # in exception messages.
        exc_detail = str(exc)[:200] if str(exc) else ""
        message = f"Secondary A2UI LLM call failed: {exc.__class__.__name__}"
        if exc_detail:
            message = f"{message}: {exc_detail}"
        return _a2ui_error(
            error=_A2uiErrorKind.LLM_ERROR,
            message=message,
            remediation=(
                "Verify the provider credentials required by LANGROID_MODEL / "
                "A2UI_MODEL are set and the provider is reachable. "
                "See server logs for the full traceback."
            ),
        )

    raw_args = _extract_tool_call_arguments(response)
    if raw_args is None:
        logger.warning(
            "generate_a2ui_via_llm: planner did not emit a render_a2ui tool call"
        )
        return _a2ui_error(
            error=_A2uiErrorKind.NO_TOOL_CALL,
            message="Secondary A2UI LLM did not call render_a2ui.",
            remediation=(
                "Retry the request. If this persists, verify the planner model "
                "supports forced function-calling."
            ),
        )
    if raw_args is _ARGS_MISSING:
        # Distinct from NO_TOOL_CALL: the planner DID produce a tool-call
        # shape but its ``arguments`` field was missing/None. "Supports
        # forced function-calling" is the wrong remediation here — the
        # actionable fix is to retry (transient) or investigate a
        # response-shape regression in the provider SDK.
        return _a2ui_error(
            error=_A2uiErrorKind.INVALID_ARGUMENTS,
            message=(
                "Secondary A2UI LLM emitted a tool-call with no arguments "
                "payload."
            ),
            remediation=(
                "Retry the request; if this persists, check server logs for a "
                "response-shape drift warning from the provider SDK."
            ),
        )

    # langroid usually pre-parses tool arguments into a dict, but some
    # provider adapters surface them as a JSON string. Handle both shapes.
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args)
        # MemoryError / RecursionError can fire on pathological payloads
        # (multi-MB JSON, deeply-nested structures). Parity with
        # ``GenerateA2UITool.handle``'s widened catch — we'd rather surface
        # a structured INVALID_ARGUMENTS than let these bubble up as an
        # uncaught 500.
        except (ValueError, TypeError, MemoryError, RecursionError) as exc:
            logger.exception(
                "generate_a2ui_via_llm: failed to parse render_a2ui arguments as JSON"
            )
            # Truncate ``str(exc)`` — parity with the LLM-error path and
            # defense against multi-KB raw LLM payloads leaking into the
            # structured error surface.
            return _a2ui_error(
                error=_A2uiErrorKind.INVALID_ARGUMENTS,
                message=f"Could not parse render_a2ui arguments: {str(exc)[:200]}",
                remediation=(
                    "Retry the request; the secondary LLM emitted malformed JSON."
                ),
            )
    else:
        args = raw_args

    if not isinstance(args, dict):
        logger.warning(
            "generate_a2ui_via_llm: render_a2ui arguments parsed to %s (not dict)",
            type(args).__name__,
        )
        return _a2ui_error(
            error=_A2uiErrorKind.INVALID_ARGUMENTS,
            message=(
                f"render_a2ui arguments must be a JSON object, got "
                f"{type(args).__name__}."
            ),
            remediation="Retry the request; the secondary LLM emitted a non-object payload.",
        )

    # ``build_a2ui_operations_from_tool_call`` can raise if required keys
    # are missing or values aren't serializable. Without this guard, an
    # upstream schema change (planner LLM returns a slightly-wrong shape)
    # produces a 500 and bypasses the structured-error contract the
    # frontend relies on.
    try:
        result = build_a2ui_operations_from_tool_call(args)
    # Widened to match the ``GenerateA2UITool.handle`` transport-path wrapper
    # and the str-arg ``json.loads`` wrapper above: IndexError / AttributeError
    # / LookupError can fire on malformed or partial payloads (planner emits a
    # dict missing a list slot; provider SDK returns a sparse attribute) and
    # must NOT escape into langroid's tool-handling stack. Narrow catches here
    # produced a 500 that bypassed the structured-error contract the frontend
    # relies on.
    except (
        KeyError,
        ValueError,
        TypeError,
        IndexError,
        AttributeError,
        LookupError,
    ) as exc:
        logger.exception(
            "generate_a2ui_via_llm: build_a2ui_operations_from_tool_call failed"
        )
        return _a2ui_error(
            error=_A2uiErrorKind.INVALID_ARGUMENTS,
            message=f"Could not build A2UI operations: {exc.__class__.__name__}",
            remediation=(
                "Retry with a simpler A2UI design or check the LLM-emitted schema."
            ),
        )

    # Defense-in-depth: the shared helper is contracted to return
    # ``{"a2ui_operations": [...]}`` but a shape regression upstream
    # (e.g. accidental ``None`` or dict without the key) would otherwise
    # bypass ``_A2uiSuccess`` and break the frontend renderer silently.
    if (
        not isinstance(result, dict)
        or "a2ui_operations" not in result
        or not isinstance(result["a2ui_operations"], list)
    ):
        # Include the first-20 sorted keys when the result IS a dict so
        # operators can tell "wrong key name" (e.g. planner emitted
        # ``operations`` instead of ``a2ui_operations``) from "wrong type".
        # The type name alone doesn't give enough signal to diagnose.
        result_keys: list[str] | None = (
            sorted(str(k) for k in result.keys())[:20]
            if isinstance(result, dict)
            else None
        )
        logger.error(
            "build_a2ui_operations_from_tool_call returned unexpected shape: "
            "type=%s keys=%r",
            type(result).__name__,
            result_keys,
        )
        return _a2ui_error(
            error=_A2uiErrorKind.INVALID_ARGUMENTS,
            message="A2UI builder returned invalid shape.",
            remediation=(
                "Upstream `build_a2ui_operations_from_tool_call` returned an "
                "unexpected result; check shared/python/tools."
            ),
        )
    return cast(_A2uiSuccess, result)


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

    Mirrors ``_A2uiErrorKind`` — both enums live in this module for the
    same reason: closed-set typing for the error surface the outer LLM
    consumes.
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
        "Generate dynamic A2UI components based on the conversation. "
        "A secondary LLM designs the UI schema and data."
    )
    context: str

    def handle(self) -> str:
        # Delegate to the provider-agnostic planner. `generate_a2ui_via_llm`
        # returns either the successful `a2ui_operations` dict or a
        # structured `_A2uiError` — both shapes are JSON-serializable and
        # are surfaced verbatim to the outer langroid agent (and thereby
        # the frontend A2UI renderer).
        result = generate_a2ui_via_llm(context=self.context)
        try:
            return _json_dumps(result)
        except (TypeError, ValueError, OverflowError, RecursionError) as exc:
            # Defensive: generate_a2ui_via_llm returns dicts by contract,
            # but if an upstream change ever returns a non-serializable
            # value we want a structured error rather than an uncaught
            # exception bubbling through langroid's tool machinery.
            # OverflowError covers NaN/inf floats; RecursionError covers
            # cyclic structures — both raised by ``json.dumps`` and not
            # subclasses of ``TypeError`` / ``ValueError``.
            logger.exception("GenerateA2UITool.handle: json.dumps failed")
            # Use the stdlib json.dumps directly here (not _json_dumps) so
            # the structured-error dump still succeeds when tests patch
            # _json_dumps to simulate a RecursionError on the success path.
            # Tests for this branch bind their side_effect to _json_dumps
            # only; the raw ``json.dumps`` remains callable and produces a
            # parseable error envelope for the frontend.
            return json.dumps(
                _a2ui_error(
                    error=_A2uiErrorKind.INVALID_ARGUMENTS,
                    message=(
                        f"Could not serialize A2UI result: "
                        f"{exc.__class__.__name__}"
                    ),
                    remediation=(
                        "This indicates an upstream planner contract bug; "
                        "see server logs."
                    ),
                )
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
# the check in production — same reasoning as ``_a2ui_error`` above.
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
    See ``_resolve_a2ui_model`` for the same reasoning on the planner
    default.

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

    return SYSTEM_PROMPT + "\n\nUser-selected style:\n- " + "\n- ".join(
        directives
    )


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
