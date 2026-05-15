"""Google ADK Sales Pipeline Agent with shared tools."""

from __future__ import annotations

import functools
import json
import logging
import os
from typing import Any, Optional, TypedDict, Union

from dotenv import load_dotenv
from google import genai
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext
from google.genai import errors as genai_errors
from google.genai import types

from agents.shared_chat import get_model, stop_on_terminal_text

# Shared tool implementations (via tools symlink -> ../../shared/python/tools)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)

load_dotenv()

logger = logging.getLogger(__name__)

# Model used for the secondary A2UI planner call. Overridable via A2UI_MODEL
# env var. gemini-2.5-flash is cheap, fast, and supports forced tool-calling
# via ToolConfig.function_calling_config.mode="ANY".
_DEFAULT_A2UI_MODEL = "gemini-2.5-flash"


def _a2ui_model() -> str:
    """Return the Gemini model for the A2UI planner, overridable via env."""
    return os.environ.get("A2UI_MODEL") or _DEFAULT_A2UI_MODEL


# Module-level google.genai client — lazily constructed on first use.
# Rebuilding the client on every generate_a2ui call re-runs env/credential
# resolution unnecessarily.
#
# `functools.lru_cache(maxsize=1)` provides thread-safe cache bookkeeping
# (the dict-lookup / insertion path is guarded), but it does NOT hold a lock
# around execution of the wrapped function body. On a cold cache, two
# concurrent callers CAN both enter `genai.Client()` — one result wins and is
# retained; the other is garbage-collected. This is acceptable here because
# `genai.Client()` is idempotent and cheap (just reads env/config), so the
# worst case is a single wasted object construction on a cold-start race.
@functools.lru_cache(maxsize=1)
def _get_genai_client():
    """Return a memoized google.genai client, constructing it on first call.

    Cache bookkeeping is thread-safe via `functools.lru_cache`; see the
    module-level comment above for the cold-cache race caveat. Call
    `.cache_clear()` in tests that need to reset the memoized instance.

    When `GOOGLE_GEMINI_BASE_URL` is set (Railway aimock proxy), the client
    is configured to send requests to that endpoint instead of the default
    Gemini API.
    """
    base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL")
    if base_url:
        return genai.Client(
            http_options={"base_url": base_url},
        )
    return genai.Client()


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Every error branch MUST populate all three keys so callers (and the LLM
    summarizing the tool result) see a consistent surface.

    NOTE: Identical TypedDicts live in
    `showcase/integrations/strands/src/agents/agent.py` and
    `showcase/integrations/langroid/src/agents/agent.py`. Those siblings call
    OpenAI directly; the google-adk sibling intentionally uses google.genai
    (forced-function-call via ToolConfig) to avoid a cross-provider openai
    dependency in a Gemini-primary package. The ERROR SHAPE still mirrors the
    siblings — keep all three in sync. Any key additions / removals must land
    in every sibling so the A2UI error surface stays consistent across
    showcase adapters.
    """

    error: str
    message: str
    remediation: str


# LlmAgent.name → frontend catalogId mapping for the shared `generate_a2ui`
# helper. Each entry mirrors the `catalogId` declared in the demo's
# `a2ui/catalog.ts` by `<CopilotKit a2ui={{ catalog }}>`. The North-Star
# pattern (langgraph-python) hardcodes a single `CUSTOM_CATALOG_ID` per
# agent file; the ADK package reuses one `generate_a2ui` across demos, so
# we dispatch by agent name instead. Add new demos here when wiring a
# fresh A2UI dynamic-schema flow.
_AGENT_NAME_TO_CATALOG_ID: dict[str, str] = {
    "DeclarativeGenUiAgent": "declarative-gen-ui-catalog",
    "BeautifulChatAgent": "copilotkit://app-dashboard-catalog",
}


def _resolve_pinned_catalog_id(tool_context: ToolContext) -> Optional[str]:
    """Return the catalogId pinned for the agent that called this tool.

    Reads the current LlmAgent's name from ADK's private `_invocation_context`
    and looks it up in `_AGENT_NAME_TO_CATALOG_ID`. Returns None if the agent
    isn't registered (in which case the caller falls back to the LLM-supplied
    catalogId, which may or may not work — but unknown agents shouldn't crash
    here).
    """
    invocation_context = getattr(tool_context, "_invocation_context", None)
    if invocation_context is None:
        return None
    agent = getattr(invocation_context, "agent", None)
    agent_name = getattr(agent, "name", None) if agent is not None else None
    if not agent_name:
        return None
    return _AGENT_NAME_TO_CATALOG_ID.get(agent_name)


def _a2ui_error(*, error: str, message: str, remediation: str) -> _A2uiError:
    """Construct and contract-check an `_A2uiError`.

    Centralizing construction lets us enforce at runtime that every error
    return from `generate_a2ui` carries all three required keys with non-empty
    string values. Typos ("remediaton") or accidental omissions blow up here
    rather than silently produce a malformed error surface.
    """
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


def get_weather(tool_context: ToolContext, location: str) -> dict:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return get_weather_impl(location)


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial database for chart data. Returns data suitable for pie or bar charts."""
    return query_data_impl(query)


def manage_sales_todos(tool_context: ToolContext, todos: list[dict]) -> dict:
    """Manage the sales pipeline by persisting the complete todo list.

    Args:
        tool_context: ADK-provided tool context; `state["todos"]` is updated.
        todos: The complete list of sales todos to maintain. Must be the
            full list (not a delta) — the implementation replaces state
            wholesale.

    Returns:
        A dict with `{"status": "updated", "count": <int>}` where `count`
        is the number of todos now stored.
    """
    result = manage_sales_todos_impl(todos)
    tool_context.state["todos"] = result
    return {"status": "updated", "count": len(result)}


def get_sales_todos(tool_context: ToolContext) -> list:
    """Get the current list of sales pipeline todos."""
    return get_sales_todos_impl(tool_context.state.get("todos"))


def schedule_meeting(
    tool_context: ToolContext, reason: str, duration_minutes: int = 30
) -> dict:
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return schedule_meeting_impl(reason, duration_minutes)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich cards. Return 2-3 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    return search_flights_impl(flights)


def generate_a2ui(tool_context: ToolContext) -> Union[_A2uiError, dict[str, Any]]:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is returned as
    an a2ui_operations container for the middleware to detect. The A2UI
    planner is a structured-output tool call that is intentionally separate
    from the primary chat turn — the primary agent decides WHEN to invoke a
    UI, and this call decides WHAT UI to render.

    Implementation: uses `google.genai.Client.models.generate_content` with a
    forced tool call (`tool_config.function_calling_config.mode="ANY"` +
    `allowed_function_names=["render_a2ui"]`). This keeps the google-adk
    package on Gemini end-to-end; the sibling strands / langroid adapters
    use OpenAI for the equivalent call but the ERROR SHAPE and user-facing
    contract are identical.

    Returns either a successful `dict[str, Any]` (the a2ui_operations
    container from `build_a2ui_operations_from_tool_call`) or an `_A2uiError`
    describing what failed, with remediation guidance for the caller / LLM.
    """
    # Extract copilotkit context entries from session state
    copilotkit_state = tool_context.state.get("copilotkit", {})
    if copilotkit_state and not isinstance(copilotkit_state, dict):
        # Schema drift signal: something set `state["copilotkit"]` to a
        # non-dict value. We silently treat it as empty (below) to keep the
        # request alive, but log a warning so operators can catch the drift.
        logger.warning(
            "generate_a2ui: tool_context.state['copilotkit'] is %s, expected dict; "
            "treating as empty (context entries will be dropped)",
            type(copilotkit_state).__name__,
        )
    if isinstance(copilotkit_state, dict):
        context_entries_raw = copilotkit_state.get("context", [])
        if not isinstance(context_entries_raw, list):
            # Schema drift: `copilotkit.context` is supposed to be a list of
            # {value: ...} dicts. Warn and coerce to empty rather than crash
            # or silently iterate over a string / dict.
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

    # Extract conversation messages from session history.
    # NOTE: `_invocation_context` is an ADK private attribute. Rather than
    # wrap the whole extraction in `try/except AttributeError` (which would
    # also swallow typos and programmer errors inside the body), we look the
    # attribute up via `getattr` and only run the body when present. If ADK
    # renames / drops the attribute, we log-and-skip instead of crashing.
    #
    # Gemini accepts `contents=` as a list of `types.Content` with role
    # `"user"` or `"model"` (no "system" role — system prompt goes via
    # `system_instruction` in the GenerateContentConfig).
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

    # Build the render_a2ui function declaration. `parametersJsonSchema` lets
    # us pass a raw JSON schema dict directly — google.genai converts it
    # internally — instead of constructing a `types.Schema` object tree.
    # Gemini structured-output is far more reliable when each `components`
    # entry has an explicit shape with required fields. Without this the
    # model produces `[{}, {}, {}]` despite the system instruction begging
    # for `id` + `component`. We declare common optional A2UI props
    # explicitly (text, label, value, children, child, data) so Gemini
    # actually emits them — its structured-output path silently drops
    # fields not present in the parameters JSON Schema, even with the
    # default `additionalProperties: true`. Catalog-specific props
    # (`color`, `dataPath`, etc.) still ride through additionalProperties
    # for less-common cases.
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
                            # Common content props
                            "text": {"type": "string"},
                            "label": {"type": "string"},
                            "value": {},
                            # Container references
                            "children": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "child": {"type": "string"},
                            # Inline data binding for charts / lists
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

    # Force the model to call render_a2ui. mode="ANY" + allowed_function_names
    # constrains the model to exactly one of the listed tools; with a single
    # entry that's equivalent to OpenAI's tool_choice={"type": "function",
    # "function": {"name": "render_a2ui"}}.
    tool_config = types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["render_a2ui"],
        ),
    )

    # Hard requirements the secondary LLM keeps violating without an explicit
    # prompt prefix:
    # - empty `{}` component entries (it ignores `components: list[dict]` schema
    #   because we don't auto-generate it from a Pydantic model)
    # - hallucinated catalogIds when no enum is available
    # - root entry with no `component` field — surfaces a "Cannot create
    #   component root without a type" loop in the renderer.
    # Mirrors `_GENERATE_A2UI_PROMPT_HEADER` from langgraph-python's
    # a2ui_dynamic.py — prepended before the catalog context so the rules
    # come FIRST in the system instruction.
    pinned_for_prompt = _resolve_pinned_catalog_id(tool_context)
    catalog_id_clause = (
        f'\n- `catalogId` MUST be exactly: "{pinned_for_prompt}".'
        if pinned_for_prompt
        else ""
    )
    hard_requirements = (
        "You are designing a dynamic A2UI v0.9 surface. Call `render_a2ui` "
        "with a flat component array.\n\n"
        "Hard requirements (failing any of these breaks the renderer — be strict):"
        + catalog_id_clause
        + '\n- `surfaceId` is a short kebab-case identifier (e.g. "kpi-dashboard").'
        + "\n- `components` is a FLAT array. Every entry MUST include both"
        + " an `id` (unique string) AND a `component` (string — the catalog"
        + ' component name). The root entry MUST have `id: "root"` AND a'
        + " valid `component` field — never emit a root entry without a"
        + " component type."
        + "\n- Container components (Row, Column, Card) reference children"
        + " by id via their `children` (array of strings) or `child` (single"
        + " string) prop. Do NOT inline children objects. Define each child"
        + " as its own entry in the flat array and reference its id."
        + "\n- Use only catalog component names listed in the schema below."
        + "\n- POPULATE EVERY DATA PROP. For charts (PieChart, BarChart) emit"
        + " a `data` field with an array of `{label, value, color?}` objects"
        + " directly on the component. For Metric / InfoRow emit `label` and"
        + " `value` strings on the component. The renderer shows a"
        + " 'No data available' placeholder if the component has no data"
        + " props — that is a USER-VISIBLE FAILURE."
        + "\n- ALSO emit a top-level `data` argument with an initial data"
        + " model for the surface (e.g."
        + ' `{"regions": [{"label": "NA", "value": 45}, ...]}`).'
        + ' The renderer\'s path bindings (`{path: "/regions"}`) resolve'
        + " against this object."
        + '\n- Never emit `{"id": "...", "component": "..."}` alone.'
        + " If a component has no other props, you have under-specified the"
        + " surface — go back and add the data fields the catalog schema"
        + " describes for that component.\n"
        + "\nExample valid `components` entry for a pie chart with inline"
        + " data:\n"
        + '  {"id": "root", "component": "PieChart",'
        + ' "data": [{"label":"NA","value":45,"color":"#3b82f6"},'
        + ' {"label":"EMEA","value":30,"color":"#10b981"},'
        + ' {"label":"APAC","value":25,"color":"#f59e0b"}]}\n'
    )
    system_instruction = (
        hard_requirements + "\n\n" + context_text if context_text else hard_requirements
    )

    generate_config = types.GenerateContentConfig(
        tools=[render_a2ui_tool],
        tool_config=tool_config,
        system_instruction=system_instruction,
    )

    # Wrap the Gemini call so expected transport / auth / rate-limit failures
    # do not bubble up through the ADK tool machinery as uncaught exceptions.
    # Return a structured error with remediation instead — the LLM can surface
    # this to the user. We deliberately narrow the except to the google.genai
    # exception hierarchy: programmer errors (AttributeError, TypeError from
    # bad call shape, etc.) should propagate so they are caught in tests and
    # not silently masked as an LLM error.
    #
    # `genai_errors.APIError` is the base class for `ClientError` (4xx) and
    # `ServerError` (5xx). Listing all three is belt-and-suspenders in case
    # the hierarchy changes; `APIError` alone catches both today. Config-time
    # failures from `genai.Client()` construction (e.g. missing
    # `GOOGLE_API_KEY`) can raise either `ValueError` or `genai_errors.*`
    # depending on the SDK path, so `_get_genai_client()` sits inside the try
    # block and `ValueError` is also in the except tuple.
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

    # Read the function call back from the first candidate's first part.
    # Gemini returns `candidates[].content.parts[].function_call` with `.args`
    # already parsed into a dict (no JSON-decode step required). mode="ANY"
    # with allowed_function_names should guarantee exactly one function_call,
    # but we still defend against empty candidates / empty parts / non-
    # function-call parts in case the model returns a refusal or the SDK
    # shape drifts.
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

    # `function_call.args` is a dict (google.genai parses the JSON for us).
    # If the SDK ever returned a raw string we'd need to json.loads it — guard
    # against that by coercing / reporting an invalid_arguments error.
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

    # FORCE-PIN catalogId per calling agent. The secondary LLM's schema for
    # `catalogId` is `{type: "string"}` with no enum/constraint, so Gemini
    # routinely hallucinates IDs like "default" or "a2ui-charts" that the
    # frontend renderer can't resolve ("Catalog not found"). The
    # langgraph-python north-star solves this by hardcoding a
    # `CUSTOM_CATALOG_ID` per agent file and ignoring the LLM's choice. We
    # mirror that here with a name→id table so one shared `generate_a2ui`
    # keeps working across multiple demos. To add a demo: register its agent
    # name (the `LlmAgent(name=...)` value) and the catalogId its frontend
    # declares via `<CopilotKit a2ui={{ catalog }}>`.
    pinned_catalog_id = _resolve_pinned_catalog_id(tool_context)
    if pinned_catalog_id:
        args = {**args, "catalogId": pinned_catalog_id}

    return build_a2ui_operations_from_tool_call(args)


def on_before_agent(callback_context: CallbackContext):
    if "todos" not in callback_context.state:
        callback_context.state["todos"] = []

    return None


def before_model_modifier(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Inspects/modifies the LLM request to include current sales pipeline state."""
    agent_name = callback_context.agent_name
    if agent_name == "SalesPipelineAgent":
        todos_json = "No sales todos yet"
        if (
            "todos" in callback_context.state
            and callback_context.state["todos"] is not None
        ):
            try:
                todos_json = json.dumps(callback_context.state["todos"], indent=2)
            except (TypeError, ValueError):
                # Do not leak the raw error into the LLM prompt — it confuses
                # the model and can bleed internal details to the user. Log
                # server-side and fall back to the neutral placeholder.
                logger.exception(
                    "before_model_modifier: failed to serialize todos state; "
                    "falling back to neutral placeholder"
                )
                todos_json = "No sales todos yet"
        original_instruction = llm_request.config.system_instruction
        # Stable prefix signature — used both to detect idempotent re-entry
        # and to strip a previously-inserted prefix so we don't stack it
        # when ADK calls the before_model_callback on the same request more
        # than once (observed in retry / reprompt paths).
        PREFIX_SIGNATURE = (
            "You are a helpful sales assistant for managing a sales pipeline."
        )
        prefix = f"""{PREFIX_SIGNATURE}
        This is the current state of the sales todos: {todos_json}
        When you modify the sales todos (whether to add, remove, or modify one or more todos), use the manage_sales_todos tool to update the list."""
        # Read the original instruction text without mutating the source
        # object. If `system_instruction` is a shared module-level
        # `types.Content` (or any object reused across requests), mutating
        # `parts[0].text` in place would re-prepend the prefix on every
        # call, stacking N times. Instead we build a fresh Content + Part
        # on every invocation and assign it to the request.
        if original_instruction is None:
            original_text = ""
        elif isinstance(original_instruction, types.Content):
            parts = original_instruction.parts or []
            original_text = (parts[0].text or "") if parts else ""
        else:
            original_text = str(original_instruction)

        # Strip any previously-prepended block (same signature → same block)
        # so repeated invocations on the same request do not stack. We look
        # for the signature and discard from the start of the string up to
        # and including the end of the most recent full prefix block.
        sig_idx = original_text.find(PREFIX_SIGNATURE)
        if sig_idx != -1:
            # Find the end of the already-inserted prefix — it terminates
            # with the known trailing sentence. If that sentence is missing
            # (mangled / drifted prefix), leave `original_text` as-is rather
            # than chopping at the signature: chopping would discard every
            # character after the signature, including legitimate user
            # content that followed a corrupted prefix. Worst case of the
            # no-op path is one duplicated signature on this single call
            # (non-stacking, because the next invocation will find an
            # end_marker since the freshly-prepended prefix has one).
            end_marker = "use the manage_sales_todos tool to update the list."
            end_idx = original_text.find(end_marker, sig_idx)
            if end_idx != -1:
                original_text = original_text[end_idx + len(end_marker) :]
            # else: leave original_text untouched — preserve user suffix.

        modified_text = prefix + original_text
        # ADK callback contract: assign a freshly constructed Content so we
        # never mutate a potentially shared instance across requests.
        llm_request.config.system_instruction = types.Content(
            role="system", parts=[types.Part(text=modified_text)]
        )

    return None


# Backwards-compatible alias. `simple_after_model_modifier` used to be a
# SalesPipelineAgent-gated copy of the loop terminator; the generic
# implementation now lives in `shared_chat.stop_on_terminal_text` and is
# wired into every registered agent. The alias survives only so the
# unit-test file `tests/python/test_after_model_modifier.py` keeps
# resolving the symbol. Both functions MUST behave identically; if you
# need to evolve termination logic, edit `stop_on_terminal_text` only.
simple_after_model_modifier = stop_on_terminal_text


sales_pipeline_agent = LlmAgent(
    name="SalesPipelineAgent",
    model=get_model(),
    instruction="""
        You are a helpful assistant.

        WEATHER:
        When the user asks about the weather, call the get_weather tool.
        If the user does not specify a location, use "Everywhere ever in the whole wide world".
        After the weather tool returns, briefly summarize the result in one sentence.

        SALES TODOS:
        When a user asks you to do anything regarding sales todos or the pipeline, use the manage_sales_todos tool.
        Always pass the COMPLETE LIST of todos to the manage_sales_todos tool.
        After using the tool, provide a brief summary of what you created, removed, or changed.

        QUERY DATA:
        Use the query_data tool when the user asks for financial data, charts, or analytics.
        This returns data suitable for pie charts and bar charts.

        GET SALES TODOS:
        Use the get_sales_todos tool to retrieve the current list of sales todos before discussing them.

        SEARCH FLIGHTS:
        Use the search_flights tool to search for flights and display rich A2UI cards.

        GENERATE A2UI:
        Use the generate_a2ui tool to generate dynamic A2UI dashboards from conversation context.

        ALWAYS provide a textual response after any tool call.
        """,
    tools=[
        get_weather,
        query_data,
        manage_sales_todos,
        get_sales_todos,
        schedule_meeting,
        search_flights,
        generate_a2ui,
    ],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=simple_after_model_modifier,
)
