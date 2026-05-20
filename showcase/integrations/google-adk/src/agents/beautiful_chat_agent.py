"""Agent backing the Beautiful Chat demo.

A canonical "polished starter" agent — has the sales-pipeline tools
(`query_data`, `search_flights`, `manage_sales_todos`, `get_sales_todos`,
`generate_a2ui`) so the demo can showcase chart cards, flight cards, task
manager (shared state), and dynamic A2UI sales dashboards alongside the
brand fonts, theme tokens, and suggestion pills on the frontend.

Tool surface matches the LP reference at
showcase/integrations/langgraph-python/src/agents/beautiful_chat.py:
- query_data           — financial rows for pie/bar charts
- manage_todos         — exposed as `manage_sales_todos` on ADK to reuse
                         the shared sales-pipeline impl (Task Manager pill)
- get_todos            — exposed as `get_sales_todos`
- search_flights       — A2UI fixed-schema flight cards
- generate_a2ui        — A2UI dynamic-schema sales dashboard

`schedule_meeting` is intentionally NOT on the agent: the frontend
registers a `scheduleTime` `useFrontendTool` (HITL) so the meeting
picker UI is driven entirely client-side. See
showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/
hooks/use-generative-ui-examples.tsx.
"""

from __future__ import annotations

import functools
import json
import logging
import os
from typing import Any, TypedDict, Union

from dotenv import load_dotenv
from google import genai
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from google.genai import errors as genai_errors
from google.genai import types
from ag_ui_adk import AGUIToolset

from agents.shared_chat import get_model, stop_on_terminal_text

# Shared tool implementations (via tools symlink -> ../../shared/python/tools).
from tools import (
    query_data_impl,
    search_flights_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    build_a2ui_operations_from_tool_call,
)

load_dotenv()

logger = logging.getLogger(__name__)

# Model used for the secondary A2UI planner call. Mirrors main.py so the
# A2UI surface generated for Beautiful Chat behaves identically to the
# Sales Pipeline demo.
_DEFAULT_A2UI_MODEL = "gemini-2.5-flash"


def _a2ui_model() -> str:
    """Return the Gemini model for the A2UI planner, overridable via env."""
    return os.environ.get("A2UI_MODEL") or _DEFAULT_A2UI_MODEL


@functools.lru_cache(maxsize=1)
def _get_genai_client():
    """Return a memoized google.genai client.

    Mirrors the cached-client pattern in `agents/main.py` so the secondary
    A2UI planner LLM call reuses a single Gemini transport instead of
    re-resolving credentials on every invocation.
    """
    base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL")
    if base_url:
        return genai.Client(
            http_options={"base_url": base_url},
        )
    return genai.Client()


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Keep in sync with `agents/main.py._A2uiError` and the sibling strands /
    langroid adapters — every A2UI error surface across showcase adapters
    populates the same three keys so the UI / LLM see consistent feedback.
    """

    error: str
    message: str
    remediation: str


def _a2ui_error(*, error: str, message: str, remediation: str) -> _A2uiError:
    """Construct and contract-check an `_A2uiError`. Mirrors main.py."""
    err: _A2uiError = {
        "error": error,
        "message": message,
        "remediation": remediation,
    }
    missing = [k for k in ("error", "message", "remediation") if not err.get(k)]
    if missing:
        raise AssertionError(
            f"_a2ui_error missing required non-empty keys: {missing}; got {err!r}"
        )
    return err


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial data — returns rows for pie / bar charts.

    Always call this before showing a chart or graph; the
    Pie Chart / Bar Chart frontend renderers expect rows shaped by
    `tools.query_data_impl`.
    """
    return query_data_impl(query)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich A2UI cards.

    Return EXACTLY 2 flights so the FlightCard surface lays out cleanly
    in the Beautiful Chat transcript. Each flight must carry:
    airline, airlineLogo (Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128 —
    e.g. domain=united.com for United, delta.com for Delta, aa.com for
    American, alaskaair.com for Alaska),
    flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" — use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"), and price (e.g. "$289").
    """
    return search_flights_impl(flights)


def manage_sales_todos(tool_context: ToolContext, todos: list[dict]) -> dict:
    """Manage the Task Manager todos by persisting the complete list.

    The Beautiful Chat "Task Manager (Shared State)" pill expects the
    agent to overwrite `state["todos"]` wholesale on every invocation —
    pass the COMPLETE list, never a delta. Returns `{status, count}` so
    the LLM can craft a brief follow-up summary.
    """
    result = manage_sales_todos_impl(todos)
    tool_context.state["todos"] = result
    return {"status": "updated", "count": len(result)}


def get_sales_todos(tool_context: ToolContext) -> list:
    """Get the current Task Manager todos for the Beautiful Chat demo."""
    return get_sales_todos_impl(tool_context.state.get("todos"))


def generate_a2ui(tool_context: ToolContext) -> Union[_A2uiError, dict[str, Any]]:
    """Generate a dynamic A2UI surface (e.g. Sales Dashboard) from context.

    Mirrors `agents/main.py.generate_a2ui` — a secondary forced-tool-call
    Gemini round-trip designs the UI schema. We keep both implementations
    deliberately parallel; if you change one, update the other (and the
    strands / langroid siblings that share the `_A2uiError` shape).
    """
    copilotkit_state = tool_context.state.get("copilotkit", {})
    if copilotkit_state and not isinstance(copilotkit_state, dict):
        logger.warning(
            "generate_a2ui: tool_context.state['copilotkit'] is %s, expected dict; "
            "treating as empty (context entries will be dropped)",
            type(copilotkit_state).__name__,
        )
    if isinstance(copilotkit_state, dict):
        context_entries_raw = copilotkit_state.get("context", [])
        if not isinstance(context_entries_raw, list):
            logger.warning(
                "generate_a2ui: tool_context.state['copilotkit']['context'] is %s, "
                "expected list; treating as empty (context entries will be dropped)",
                type(context_entries_raw).__name__,
            )
            context_entries = []
        else:
            context_entries = context_entries_raw
    else:
        context_entries = []
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    # Replay conversation contents to the secondary planner LLM. Gemini
    # accepts `contents=` as a list of `types.Content` with role "user" or
    # "model" — no "system" role; system prompt goes via
    # `system_instruction`. `_invocation_context` is an ADK private attr;
    # guard against shape drift the same way main.py does.
    conversation_contents: list[types.Content] = []
    invocation_context = getattr(tool_context, "_invocation_context", None)
    if invocation_context is None:
        logger.debug(
            "generate_a2ui: tool_context has no _invocation_context attribute; "
            "ADK private-API shape may have drifted. Skipping session history."
        )
    else:
        session = getattr(invocation_context, "session", None)
        if session and hasattr(session, "events"):
            for event in session.events:
                if (
                    hasattr(event, "content")
                    and event.content
                    and hasattr(event.content, "parts")
                ):
                    role_str = getattr(event.content, "role", "")
                    if role_str in ("user", "model"):
                        text_parts = []
                        for part in event.content.parts:
                            if hasattr(part, "text") and part.text:
                                text_parts.append(part.text)
                        if text_parts:
                            conversation_contents.append(
                                types.Content(
                                    role=role_str,
                                    parts=[types.Part(text="".join(text_parts))],
                                )
                            )

    # Stricter components schema — without per-item `id`/`component`
    # required, Gemini emits `[{}, {}, {}]`. Common optional props are
    # declared explicitly so Gemini's structured-output path keeps them
    # (it silently drops fields not in the schema even with the default
    # `additionalProperties: true`). Mirrors the same fix in
    # `agents/main.py:generate_a2ui`.
    render_a2ui_declaration = types.FunctionDeclaration(
        name="render_a2ui",
        description="Render a dynamic A2UI v0.9 surface.",
        parametersJsonSchema={
            "type": "object",
            "properties": {
                "surfaceId": {"type": "string"},
                "catalogId": {"type": "string"},
                "components": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "component": {"type": "string"},
                            "text": {"type": "string"},
                            "label": {"type": "string"},
                            "value": {},
                            "children": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "child": {"type": "string"},
                            "data": {},
                        },
                        "required": ["id", "component"],
                    },
                },
                "data": {"type": "object"},
            },
            "required": ["surfaceId", "catalogId", "components"],
        },
    )
    render_a2ui_tool = types.Tool(function_declarations=[render_a2ui_declaration])

    tool_config = types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["render_a2ui"],
        ),
    )

    # Beautiful-chat's catalog ID is the package default
    # (`copilotkit://app-dashboard-catalog`) so we don't need the
    # per-agent pinning that declarative-gen-ui requires. Still prepend
    # the hard-requirements clause so Gemini doesn't emit empty entries.
    hard_requirements = (
        "You are designing a dynamic A2UI v0.9 surface. Call `render_a2ui` "
        "with a flat component array.\n\n"
        "Hard requirements (failing any of these breaks the renderer — be strict):"
        '\n- `catalogId` MUST be exactly: "copilotkit://app-dashboard-catalog".'
        '\n- `surfaceId` is a short kebab-case identifier (e.g. "sales-dashboard").'
        "\n- `components` is a FLAT array. Every entry MUST include both an"
        " `id` (unique string) AND a `component` (string — the catalog"
        ' component name). The root entry MUST have `id: "root"` AND a'
        " valid `component` field."
        "\n- Container components reference children by id via their"
        " `children` (array of strings) or `child` (single string) prop."
        "\n- Use only catalog component names listed in the schema below.\n"
    )
    system_instruction = (
        hard_requirements + "\n\n" + context_text if context_text else hard_requirements
    )

    generate_config = types.GenerateContentConfig(
        tools=[render_a2ui_tool],
        tool_config=tool_config,
        system_instruction=system_instruction,
    )

    try:
        client = _get_genai_client()
        response = client.models.generate_content(
            model=_a2ui_model(),
            contents=conversation_contents or None,
            config=generate_config,
        )
    except (
        genai_errors.APIError,
        genai_errors.ClientError,
        genai_errors.ServerError,
        ValueError,
    ) as exc:
        logger.exception("generate_a2ui: Gemini API call failed")
        return _a2ui_error(
            error="a2ui_llm_error",
            message=f"Secondary A2UI LLM call failed: {exc.__class__.__name__}: {exc}",
            remediation=(
                "Verify GOOGLE_API_KEY is set and the Gemini service is reachable. "
                "See server logs for the full traceback."
            ),
        )

    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        logger.warning("generate_a2ui: Gemini response contained no candidates")
        return _a2ui_error(
            error="a2ui_empty_response",
            message="Secondary A2UI LLM returned no candidates.",
            remediation="Retry; if this persists, check Gemini service status.",
        )

    first_content = getattr(candidates[0], "content", None)
    parts = getattr(first_content, "parts", None) or [] if first_content else []
    if not parts:
        logger.warning("generate_a2ui: Gemini response had no parts in first candidate")
        return _a2ui_error(
            error="a2ui_empty_response",
            message="Secondary A2UI LLM returned no parts.",
            remediation="Retry; if this persists, check Gemini service status.",
        )

    function_call = None
    for part in parts:
        fc = getattr(part, "function_call", None)
        if fc is not None and getattr(fc, "name", None) == "render_a2ui":
            function_call = fc
            break

    if function_call is None:
        logger.warning(
            "generate_a2ui: Gemini response had no render_a2ui function_call "
            "despite forced tool_config mode=ANY"
        )
        return _a2ui_error(
            error="a2ui_no_tool_call",
            message="Secondary A2UI LLM did not call render_a2ui.",
            remediation=(
                "Retry the request. If this persists, verify the tool_config "
                "schema matches the google.genai API contract."
            ),
        )

    args = getattr(function_call, "args", None)
    if args is None:
        logger.warning("generate_a2ui: render_a2ui function_call had no args")
        return _a2ui_error(
            error="a2ui_invalid_arguments",
            message="render_a2ui function_call returned no arguments.",
            remediation="Retry the request; the secondary LLM emitted an empty tool call.",
        )
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except (ValueError, TypeError) as exc:
            logger.exception(
                "generate_a2ui: failed to parse render_a2ui args string as JSON"
            )
            return _a2ui_error(
                error="a2ui_invalid_arguments",
                message=f"Could not parse render_a2ui arguments: {exc}",
                remediation="Retry the request; the secondary LLM emitted malformed JSON.",
            )
    if not isinstance(args, dict):
        logger.warning(
            "generate_a2ui: render_a2ui args was %s, expected dict",
            type(args).__name__,
        )
        return _a2ui_error(
            error="a2ui_invalid_arguments",
            message=f"render_a2ui arguments had unexpected type: {type(args).__name__}",
            remediation="Retry the request; the secondary LLM emitted a non-dict payload.",
        )
    # Force-pin the catalogId so Gemini can't hallucinate a non-existent ID.
    # The pinning table lives in `agents.main` to keep one source of truth;
    # this file's local `generate_a2ui` and `main.py`'s shared one both
    # delegate to it.
    from agents.main import _resolve_pinned_catalog_id

    pinned_catalog_id = _resolve_pinned_catalog_id(tool_context)
    if pinned_catalog_id:
        args = {**args, "catalogId": pinned_catalog_id}

    return build_a2ui_operations_from_tool_call(args)


# Ported (with light adaptation for ADK tool naming) from LP's
# beautiful_chat.py system_prompt. The frontend exercises 9 pills covering
# A2UI fixed + dynamic, controlled GenUI charts, MCP apps, HITL meetings,
# Open Gen UI calculator, frontend tools, and shared-state todos — so the
# agent needs concise per-tool guidance to pick the right surface.
_INSTRUCTION = """
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Flights: call search_flights to show flight cards with a pre-built schema.
        - Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
          charts, tables, and cards. It handles rendering automatically.
        - Charts: call query_data first, then render with the chart component.
        - Todos / Task Manager: call manage_sales_todos to update the complete todo
          list, or get_sales_todos to read the current list before discussing them.
          Always pass the COMPLETE list to manage_sales_todos.
        - Interactive / sandboxed widgets (calculator, custom forms, mini-apps):
          call generateSandboxedUi to create a self-contained HTML+CSS+JS widget
          rendered inside a sandboxed iframe. Use this when the user asks for
          something that isn't a dashboard (so generate_a2ui doesn't apply) but
          benefits from a live, interactive UI — calculators, color pickers,
          quizzes, etc. Keep the chat reply to one short sentence; the rendered
          widget is the real output.

          Sandbox iframe restrictions (CRITICAL — these are silently enforced by
          the browser, so the LLM has to know):
          - The iframe runs with `sandbox="allow-scripts"` ONLY. `<form>` and
            `<button type="submit">` are blocked BEFORE any onsubmit handler
            runs — never use a form for interactivity.
          - Use plain `<button type="button">` elements and wire them with
            `addEventListener('click', ...)`. Do the same for keyboard input:
            attach a `keydown` listener that checks `e.key === 'Enter'` and
            calls your handler directly instead of wrapping inputs in a form.
          - All click/keypress handlers must live inside a `<script>` tag in
            the generated `html` (the iframe runs the html plus a small
            postMessage shim). Top-level expressions are fine; no `fetch`,
            no `localStorage`, no `document.cookie`.
          - For calculators: render `<button type="button" data-key="7">7</button>`
            etc. and a single `document.addEventListener('click', e => { ... })`
            that reads `e.target.dataset.key` and updates an output `<div>`.
            Wire the metric-shortcut buttons the same way; reading their
            `data-value` to push the numeric value into the display.
        - A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
          respond with a brief confirmation. The UI already updated on the frontend.
        - Meeting scheduling is handled entirely on the frontend via the
          `scheduleTime` HITL tool — do NOT try to schedule meetings yourself.
"""


beautiful_chat_agent = LlmAgent(
    name="BeautifulChatAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[
        query_data,
        search_flights,
        manage_sales_todos,
        get_sales_todos,
        generate_a2ui,
        AGUIToolset(),
    ],
    after_model_callback=stop_on_terminal_text,
)
