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
from typing import TypedDict

from strands import tool

# Shared tool implementations, symlinked at the project root
# (→ ../../shared/python/tools). ``build_a2ui_operations_from_tool_call`` wraps
# the inner model's ``render_a2ui`` arguments in the nested A2UI v0.9
# ``a2ui_operations`` envelope the middleware detects in a tool result.
from tools import build_a2ui_operations_from_tool_call

logger = logging.getLogger(__name__)


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Mirrors the google-adk and langroid sibling agents' error shape — keep
    all three in sync. Every error branch MUST populate all three keys so
    callers (and the LLM summarizing the tool result) see a consistent
    surface.
    """

    error: str
    message: str
    remediation: str



# The `generate_a2ui` tool runs a secondary LLM call with a forced
# `render_a2ui` tool, then converts that tool call's args into the
# A2UI `a2ui_operations` container via
# `build_a2ui_operations_from_tool_call`. The ag_ui_strands middleware
# detects the container in the tool result and forwards the ops to
# the frontend, which resolves component names through the registered
# catalog (`copilotkit://generative-catalog`).
@tool
def generate_a2ui(context: str) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.

    Error branches return a JSON-serialized ``_A2uiError`` dict rather
    than raising, so OpenAI transport / quota / auth failures surface to
    the LLM as a structured tool result (not an uncaught exception in the
    strands tool machinery). See ``_A2uiError`` above.

    Args:
        context: Conversation context to generate UI from

    Returns:
        A2UI operations (or ``_A2uiError``) as JSON string
    """
    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
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
            model="gpt-4.1",
            messages=[
                {
                    "role": "system",
                    "content": context or "Generate a useful dashboard UI.",
                },
                {
                    "role": "user",
                    "content": "Generate a dynamic A2UI dashboard based on the conversation.",
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

    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)


# @endregion[backend-render-operations]
