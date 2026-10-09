"""A2UI dynamic generation — Strands ``generate_a2ui`` tool.

Mirrors the per-demo specialization pattern used by ``gen_ui_agent.py`` and
``a2ui_dynamic.py``: this module owns the tool definition and its structured
error shape, and ``agent.py`` wires it into the shared ``StrandsAgent``
instance.

It also keeps this integration's slice of the A2UI docs honest. The
``backend-render-operations`` region below is what
`/aws-strands/generative-ui/a2ui/fixed-schema` renders, and a region starts at
the top of its file so the snippet carries its own imports (see the
marker-hoist sweep in 34b6418). While the tool lived in ``agent.py`` that made
the published snippet the whole 1688-line module; here the snippet is just the
tool (OSS-901).
"""

# @region[backend-render-operations]
import json
import logging
import uuid
from typing import TypedDict

from strands import tool
from strands.types.tools import ToolContext
from tools.a2ui_catalog import read_client_catalog, validate_client_surface

# Shared implementation emits the A2UI v0.9 envelope detected by middleware.
from tools import build_a2ui_operations_from_tool_call

logger = logging.getLogger(__name__)


class _A2uiError(TypedDict):
    """Structured error contract shared with google-adk and langroid."""

    error: str
    message: str
    remediation: str


@tool(context=True)
def generate_a2ui(context: str, tool_context: ToolContext) -> str:
    """Generate a host-catalog A2UI surface, or a structured tool error.

    Args:
        context: Conversation context to generate UI from
    """
    try:
        catalog = read_client_catalog(
            tool_context.agent.state.get("agui_context") or []
        )
    except (ValueError, TypeError) as exc:
        return json.dumps(
            _A2uiError(
                error="a2ui_missing_catalog",
                message=str(exc),
                remediation="Register an A2UI catalog on the host and forward its component schema in request context.",
            )
        )

    surface_id = f"dashboard-{uuid.uuid4()}"
    # Read query results from the executing agent, not a model-authored summary.
    # The primary model often supplies only layout instructions in `context`.
    user_request = ""
    query_ids = set()
    query_results = []
    for message in tool_context.agent.messages:
        for block in message.get("content", []):
            if message.get("role") == "user" and isinstance(block.get("text"), str):
                user_request = block["text"]
            call = block.get("toolUse", {})
            if call.get("name") == "query_data":
                query_ids.add(call["toolUseId"])
            result = block.get("toolResult", {})
            if result.get("toolUseId") in query_ids:
                query_results.append(result.get("content", []))

    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "catalogId": {"type": "string", "enum": [catalog["catalogId"]]},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["catalogId", "components"],
            },
        },
    }

    # Wrap the OpenAI call so raw SDK / transport failures do NOT bubble up
    # through the strands tool machinery as uncaught exceptions. Return a
    # structured error with remediation instead — the LLM can surface this
    # to the user. Mirrors the google-adk and langroid sibling agents'
    # error-handling shape — keep all three in sync.
    #
    # Exception scope is broad on the SDK side but still bounded:
    #   * ``openai.OpenAIError`` covers config-time failures (e.g. from
    #     ``OpenAI()`` constructor when ``OPENAI_API_KEY`` is unset).
    #     ``APIError`` subclasses (RateLimitError, APIConnectionError,
    #     AuthenticationError, BadRequestError, etc.) are also caught via
    #     the broader ``except`` tuple. Verified against ``openai>=1.0`` —
    #     re-check hierarchy on major version bumps.
    #   * ``httpx.HTTPError`` covers transport failures (ConnectError,
    #     ReadTimeout, RemoteProtocolError) that can escape below the SDK's
    #     wrap layer in rare cases.
    # Programmer errors (AttributeError, NameError, TypeError from bad
    # kwargs, etc.) still propagate so bugs are not silently swallowed as
    # "LLM error". Note the client construction itself is inside the try
    # block for the same reason.
    import openai as _openai_mod
    import httpx as _httpx_mod

    try:
        client = _openai_mod.OpenAI()
        response = client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "CRITICAL: Generate a flat A2UI v0.9 surface using only the host catalog below. "
                        "The root component must have id root. Never add a property not declared "
                        "in that component schema (other than id). Use the exact component properties "
                        "and actual query results supplied in the request. Do not invent data. "
                        "Calculate totals and chart series from those results. If a requested "
                        "metric cannot be derived, label it unavailable instead of leaving it blank.\n"
                        + json.dumps(catalog)
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        user_request or context or "Generate a useful dashboard UI."
                    )
                    + "\n\nAuthoritative query_data results:\n"
                    + json.dumps(query_results),
                },
            ],
            tools=[tool_schema],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )
    except (_openai_mod.OpenAIError, _httpx_mod.HTTPError) as exc:
        logger.exception("generate_a2ui: OpenAI API call failed")
        return json.dumps(
            _A2uiError(
                error="a2ui_llm_error",
                message=f"Secondary A2UI LLM call failed: {exc.__class__.__name__}",
                remediation=(
                    "Verify OPENAI_API_KEY is set and the OpenAI service is reachable. "
                    "See server logs for the full traceback."
                ),
            )
        )

    if not response.choices:
        logger.warning("generate_a2ui: OpenAI response contained no choices")
        return json.dumps(
            _A2uiError(
                error="a2ui_empty_response",
                message="Secondary A2UI LLM returned no choices.",
                remediation="Retry; if this persists, check OpenAI status.",
            )
        )

    tool_calls = response.choices[0].message.tool_calls
    if not tool_calls:
        logger.warning(
            "generate_a2ui: OpenAI response had no tool_calls despite forced tool_choice"
        )
        return json.dumps(
            _A2uiError(
                error="a2ui_no_tool_call",
                message="Secondary A2UI LLM did not call render_a2ui.",
                remediation=(
                    "Retry the request. If this persists, verify the tool_choice "
                    "schema matches the OpenAI API contract."
                ),
            )
        )

    tool_call = tool_calls[0]
    try:
        args = json.loads(tool_call.function.arguments)
    except (ValueError, TypeError) as exc:
        logger.exception(
            "generate_a2ui: failed to parse render_a2ui tool arguments as JSON"
        )
        return json.dumps(
            _A2uiError(
                error="a2ui_invalid_arguments",
                message=f"Could not parse render_a2ui arguments: {exc}",
                remediation="Retry the request; the secondary LLM emitted malformed JSON.",
            )
        )

    try:
        if isinstance(args, dict):
            args["surfaceId"] = surface_id
        validate_client_surface(args, catalog)
    except ValueError as exc:
        return json.dumps(
            _A2uiError(
                error="a2ui_invalid_surface",
                message=str(exc),
                remediation="Generate a surface matching the supplied host catalog and component schemas.",
            )
        )

    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)


# @endregion[backend-render-operations]
