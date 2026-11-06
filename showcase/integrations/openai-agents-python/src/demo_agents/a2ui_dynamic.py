"""A2UI dynamic schema: a secondary model call designs the whole surface.

Backend-owned, like google-adk's and google-antigravity's wiring rather than
the runtime auto-injection langgraph-python's declarative-gen-ui uses.
``generate_a2ui`` is an ordinary function tool. Its body:

1. reads the run's app context, which the adapter hands the tools as the
   SDK run context: the page's sales dataset and composition rules
   (``useAgentContext``) and the A2UI component schema the provider sends
   for its catalog;
2. assembles the sub-agent prompt with the A2UI toolkit
   (``prepare_a2ui_request``: generation + design guidelines, the context
   entries, ``## Available Components``);
3. makes its own Responses API call, forced onto a single ``render_a2ui``
   function (``tool_choice``);
4. validates the result and retries with the errors appended to the prompt
   (the toolkit's ``run_a2ui_generation_with_recovery``, up to
   ``MAX_ATTEMPTS``);
5. returns the ``a2ui_operations`` envelope, or the
   ``a2ui_recovery_exhausted`` envelope once every attempt failed.

The adapter JSON-encodes the return value into ``TOOL_CALL_RESULT``, where
the runtime's A2UI middleware paints the surface or shows the failure card.
The route sets ``injectA2UITool: false`` so the runtime does not also hand the
model a ``render_a2ui`` frontend tool.

Validation is structural only (no catalog): the provider's schema lists only
the custom components, so checking membership against it would reject the
basic-catalog Row/Column/Text the surfaces are built from. Structural checks
(ids, root, child references, cycles, bindings) are what the recovery demo
exercises. The toolkit's recovery loop is synchronous, so it runs on a
worker thread and each attempt's model call is scheduled back onto the loop.
"""

import asyncio
import json
import logging
from typing import Any

from ag_ui.core import Context
from ag_ui_a2ui_toolkit import (
    RENDER_A2UI_TOOL_DEF,
    build_a2ui_envelope,
    prepare_a2ui_request,
    resolve_a2ui_catalog,
    run_a2ui_generation_with_recovery,
    split_a2ui_schema_context,
)
from agents import Agent, RunContextWrapper, function_tool
from openai import OpenAIError

from demo_agents._common import MODEL, openai_client

logger = logging.getLogger(__name__)

# The catalog the declarative-gen-ui page registers (a2ui/catalog.ts); the
# a2ui-recovery page reuses it. Used when the run carries no schema entry
# naming a catalog.
CATALOG_ID = "declarative-gen-ui-catalog"
DEFAULT_SURFACE_ID = "sales-surface"
RENDER_TOOL_NAME = "render_a2ui"
# Initial try + retries; matches the toolkit default and the renderer's
# "Retrying… (N/M)" label.
MAX_ATTEMPTS = 3

# The toolkit's render_a2ui definition in the Responses API's function shape.
RENDER_A2UI_TOOL = {
    "type": "function",
    "name": RENDER_TOOL_NAME,
    "description": RENDER_A2UI_TOOL_DEF["function"]["description"],
    "parameters": RENDER_A2UI_TOOL_DEF["function"]["parameters"],
    "strict": False,
}


def _parse_json_arg(value: Any, expect: type) -> Any:
    """Parses a JSON-string argument; anything unparseable is returned as is.

    A value left as a string fails validation, so the recovery loop retries
    instead of painting garbage. A lone component object is wrapped in a list.
    """
    if not isinstance(value, str):
        parsed = value
    else:
        try:
            parsed = json.loads(value)
        except ValueError:
            return value
    if expect is list and isinstance(parsed, dict):
        return [parsed]
    return parsed


def coerce_render_args(args: dict) -> dict:
    """``render_a2ui`` arguments with ``components``/``data`` as list/dict."""
    coerced = dict(args)
    if "components" in coerced:
        coerced["components"] = _parse_json_arg(coerced["components"], list)
    if "data" in coerced:
        coerced["data"] = _parse_json_arg(coerced["data"], dict)
    return coerced


async def render_once(system_prompt: str, request: str) -> dict | None:
    """One forced ``render_a2ui`` call. ``None`` when the model did not call it.

    ``request`` is the user turn. The recovery fixtures match the retry by
    the error block the toolkit appends to ``system_prompt``.
    """
    try:
        response = await openai_client().responses.create(
            model=MODEL,
            instructions=system_prompt,
            input=request,
            tools=[RENDER_A2UI_TOOL],
            tool_choice={"type": "function", "name": RENDER_TOOL_NAME},
        )
    except OpenAIError:
        # Counted as a failed attempt; the loop retries and, if every attempt
        # fails, the user sees the recovery-exhausted card instead of a hang.
        logger.exception("render_a2ui call failed")
        return None
    for item in response.output:
        if item.type == "function_call" and item.name == RENDER_TOOL_NAME:
            try:
                args = json.loads(item.arguments or "{}")
            except ValueError:
                return None
            return coerce_render_args(args) if isinstance(args, dict) else None
    return None


def _log_attempt(record: dict) -> None:
    logger.info(
        "[a2ui recovery] attempt %s: %s %s",
        record.get("attempt"),
        "valid" if record.get("ok") else "invalid",
        record.get("errors"),
    )


def _subagent_state(app_context: list[Context]) -> dict:
    """The run's context in the ``state["ag-ui"]`` shape the toolkit reads."""
    entries = [{"description": e.description, "value": e.value} for e in app_context]
    schema, regular = split_a2ui_schema_context(entries)
    ag_ui: dict = {"context": regular}
    if schema:
        ag_ui["a2ui_schema"] = schema
    return {"ag-ui": ag_ui}


def _catalog_id(state: dict) -> str:
    """The catalog the page registered (its schema entry's ``catalogId``).

    Falls back to ``CATALOG_ID`` when the schema entry is absent or carries
    no id, so a surface always names a catalog the page can resolve.
    """
    resolved = resolve_a2ui_catalog(state)
    return (resolved[1] if resolved else None) or CATALOG_ID


@function_tool
async def generate_a2ui(
    ctx: RunContextWrapper[list[Context] | None], request: str
) -> dict:
    """Draw a rich visual A2UI surface (dashboard, table, cards) for a request.

    Pass the user's question verbatim as `request`. A secondary model designs
    the surface from the sales data and composition rules in the app context,
    so do not add figures or layout instructions yourself.

    The JSON returned is the surface descriptor the UI has already rendered
    (or a failure the UI has already shown), not something to repeat. Do NOT
    call this tool again for the same question. Reply with one short sentence
    and stop.
    """
    state = _subagent_state(ctx.context or [])
    catalog_id = _catalog_id(state)
    prep = prepare_a2ui_request(
        intent="create",
        target_surface_id=None,
        changes=None,
        messages=[],
        state=state,
    )
    loop = asyncio.get_running_loop()

    def invoke_subagent(prompt: str, _attempt: int) -> dict | None:
        future = asyncio.run_coroutine_threadsafe(render_once(prompt, request), loop)
        return future.result()

    def build_envelope(generated: dict) -> str:
        return build_a2ui_envelope(
            args=generated,
            is_update=False,
            target_surface_id=None,
            prior=None,
            default_surface_id=DEFAULT_SURFACE_ID,
            default_catalog_id=catalog_id,
        )

    result = await asyncio.to_thread(
        run_a2ui_generation_with_recovery,
        base_prompt=prep["prompt"],
        invoke_subagent=invoke_subagent,
        build_envelope=build_envelope,
        config={"maxAttempts": MAX_ATTEMPTS},
        on_attempt=_log_attempt,
    )
    return json.loads(result["envelope"])


# Same persona and rules as langgraph-python's a2ui_dynamic.py SYSTEM_PROMPT;
# only the tool contract differs (this generate_a2ui takes the request).
SYSTEM_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your app context. Answer every "
    "business question by calling `generate_a2ui` to draw a rich visual "
    "surface, and keep the chat reply to one short sentence.\n"
    "\n"
    "Pass the user's question verbatim as `request`: the tool reads the "
    "sales dataset and the dashboard composition rules from the app context "
    "itself and picks the components by the shape of the question (snapshot "
    "→ composed KPI dashboard with charts; team performance → table; risk "
    "→ status badges; single account → info rows; part-of-whole → pie; "
    "trend/comparison → bar). Never ask the user which chart they want. "
    "Call `generate_a2ui` exactly once per question; it has already "
    "rendered the surface when it returns."
)


declarative_gen_ui_agent = Agent(
    name="sales_analyst",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    tools=[generate_a2ui],
)
