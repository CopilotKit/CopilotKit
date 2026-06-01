"""Regression tests for the A2UI internal-tool wiring.

Three classes of bug we want to keep from coming back:

1. **Middleware intercept by tool name.** `@ag-ui/a2ui-middleware`'s default
   `a2uiToolNames` is `["render_a2ui"]`. If our internal secondary-LLM tool
   is ever named `render_a2ui` again, the middleware will synthesise
   ACTIVITY_SNAPSHOT events from the LLM's RAW streaming args, bypassing
   our Python-side validation. The test below asserts the bound tool's
   name does NOT match the intercept list.

2. **Catalog-id hallucination leak.** `generate_a2ui` force-pins
   `catalog_id` to the module-level constant after the secondary LLM call,
   so a hallucinated catalogId in the LLM's tool-call args cannot leak
   through to the surface op. We mock the secondary LLM with a bad
   catalogId and assert the canonical one wins.

3. **Malformed root drops cleanly.** `generate_a2ui` removes components
   missing `id`/`component` and bails with a clear error if no valid root
   survives — never feeds the renderer a partial tree that infinite-loops
   it ("Cannot create component root without a type").
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

# `display_flight` lives in a2ui_fixed.py and is the OUTER agent tool. Its
# name is `display_flight` (not `render_a2ui`), so the middleware can't
# intercept it. We assert this stays so even if someone renames it.
from src.agents.a2ui_fixed import display_flight as a2ui_fixed_display_flight

# `_design_a2ui_surface` is the INNER, secondary-LLM-bound helper inside
# beautiful_chat.py and a2ui_dynamic.py. The leading underscore + descriptive
# name signals "internal"; the rename was forced because the prior name
# (`render_a2ui`) collided with the A2UI middleware's default intercept list.
from src.agents.beautiful_chat import (
    _design_a2ui_surface as beautiful_chat_design,
    generate_a2ui as beautiful_chat_generate_a2ui,
    CUSTOM_CATALOG_ID as BEAUTIFUL_CHAT_CATALOG_ID,
)
from src.agents.a2ui_dynamic import (
    _design_a2ui_surface as a2ui_dynamic_design,
    generate_a2ui as a2ui_dynamic_generate_a2ui,
    CUSTOM_CATALOG_ID as A2UI_DYNAMIC_CATALOG_ID,
)


# A2UI middleware's default intercept list (mirrors `RENDER_A2UI_TOOL_NAME`
# in `@ag-ui/a2ui-middleware`). Any tool here gets its streaming args parsed
# as A2UI surface ops, bypassing the tool's Python body.
A2UI_MIDDLEWARE_INTERCEPTED_NAMES = {"render_a2ui"}


# ---------------------------------------------------------------------------
# Tool-name regressions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "tool",
    [
        beautiful_chat_design,
        a2ui_dynamic_design,
    ],
    ids=["beautiful_chat", "a2ui_dynamic"],
)
def test_secondary_llm_tool_name_does_not_collide_with_middleware_intercept(tool):
    """The secondary-LLM helper name must not appear in the A2UI middleware's
    default intercept list — otherwise the middleware synthesises surface
    events from the LLM's raw streaming args before our Python force-pin runs.
    """
    assert tool.name not in A2UI_MIDDLEWARE_INTERCEPTED_NAMES, (
        f"Secondary-LLM helper is named {tool.name!r}, which the A2UI "
        f"middleware default-intercepts ({A2UI_MIDDLEWARE_INTERCEPTED_NAMES}). "
        f"This bypasses our catalog/component validation. Pick a name not in "
        f"that set (e.g. `_design_a2ui_surface`)."
    )


def test_a2ui_fixed_display_flight_name_unchanged():
    """`display_flight` is the OUTER tool the primary agent calls. Renaming
    it to anything in the middleware's intercept list would break the
    fixed-schema demo in the same way."""
    assert a2ui_fixed_display_flight.name not in A2UI_MIDDLEWARE_INTERCEPTED_NAMES, (
        f"a2ui_fixed.display_flight is named {a2ui_fixed_display_flight.name!r}, "
        f"which collides with the A2UI middleware's intercept list."
    )


# ---------------------------------------------------------------------------
# Helpers for the catalog-id force-pin / malformed-root tests
# ---------------------------------------------------------------------------


class _StubResponse:
    """Stand-in for the secondary LLM's response. `tool_calls` is the only
    field `generate_a2ui` reads."""

    def __init__(self, tool_calls: list[dict]):
        self.tool_calls = tool_calls


class _StubModelWithTool:
    """Captures the tool-bind call (so we can assert on it) and replays a
    canned response on `.invoke(...)`."""

    def __init__(self, response: _StubResponse):
        self._response = response

    def invoke(self, _messages):
        return self._response


class _StubChatOpenAI:
    def __init__(self, response: _StubResponse):
        self._response = response
        self.bound_tools: list[Any] = []
        self.tool_choice: Any = None

    def bind_tools(self, tools, tool_choice=None):
        self.bound_tools = tools
        self.tool_choice = tool_choice
        return _StubModelWithTool(self._response)


class _FakeRuntime:
    """Mimics the `ToolRuntime` shape that `generate_a2ui` reads — only
    `state["messages"]` and `state.get("copilotkit", {})` are touched."""

    def __init__(self):
        self.state = {
            "messages": [
                # Outer assistant tool-call message (sliced off by [:-1]).
                {"role": "user", "content": "show me a dashboard"},
                {"role": "assistant", "content": "calling generate_a2ui"},
            ],
            "copilotkit": {"context": []},
        }


def _parse_render_output(rendered: str) -> dict:
    """`a2ui.render(...)` returns `json.dumps({"a2ui_operations": [...]})`."""
    return json.loads(rendered)


def _create_surface_op(parsed: dict) -> dict:
    ops = parsed["a2ui_operations"]
    create_surface = next(
        op for op in ops if "createSurface" in op or op.get("type") == "create_surface"
    )
    # Python SDK serialises ops as `{"version": "v0.9", "createSurface": {...}}`.
    return create_surface.get("createSurface", create_surface)


# ---------------------------------------------------------------------------
# Catalog-id force-pin
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "agent_module_name,generate_a2ui_fn,expected_catalog_id",
    [
        ("beautiful_chat", beautiful_chat_generate_a2ui, BEAUTIFUL_CHAT_CATALOG_ID),
        ("a2ui_dynamic", a2ui_dynamic_generate_a2ui, A2UI_DYNAMIC_CATALOG_ID),
    ],
)
def test_generate_a2ui_force_pins_canonical_catalog_id(
    agent_module_name: str,
    generate_a2ui_fn,
    expected_catalog_id: str,
):
    """If the secondary LLM hallucinates a catalogId, the outer
    `generate_a2ui` must override it with the canonical one before
    constructing the surface op."""
    bad_catalog_id = "not-the-registered-catalog"
    response = _StubResponse(
        tool_calls=[
            {
                "name": "_design_a2ui_surface",
                "args": {
                    "surfaceId": "test-surface",
                    "catalogId": bad_catalog_id,
                    "components": [
                        {"id": "root", "component": "Column", "children": ["m"]},
                        {"id": "m", "component": "Metric", "label": "x", "value": "1"},
                    ],
                },
            }
        ]
    )

    with patch(f"src.agents.{agent_module_name}.ChatOpenAI") as mock_chat:
        mock_chat.return_value = _StubChatOpenAI(response)
        rendered = generate_a2ui_fn.func(
            _FakeRuntime()
        )  # `.func` unwraps the @tool decorator

    parsed = _parse_render_output(rendered)
    create_surface = _create_surface_op(parsed)
    actual_catalog_id = create_surface.get("catalogId")

    assert actual_catalog_id == expected_catalog_id, (
        f"{agent_module_name}.generate_a2ui leaked the LLM's hallucinated "
        f"catalogId {actual_catalog_id!r}; expected force-pin to "
        f"{expected_catalog_id!r}."
    )


# ---------------------------------------------------------------------------
# Malformed-root drop
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "agent_module_name,generate_a2ui_fn",
    [
        ("beautiful_chat", beautiful_chat_generate_a2ui),
        ("a2ui_dynamic", a2ui_dynamic_generate_a2ui),
    ],
)
def test_generate_a2ui_drops_malformed_root_with_error_not_loop(
    agent_module_name: str,
    generate_a2ui_fn,
):
    """If the secondary LLM emits a root component without a `component`
    type, `generate_a2ui` must short-circuit with a clean error string
    rather than feed the renderer a partial tree (which surfaces as the
    "Cannot create component root without a type" infinite-loop error
    on the frontend)."""
    response = _StubResponse(
        tool_calls=[
            {
                "name": "_design_a2ui_surface",
                "args": {
                    "surfaceId": "test-surface",
                    "catalogId": "irrelevant",  # force-pin will overwrite anyway
                    # Root has `id` but NO `component` field.
                    "components": [{"id": "root", "title": "broken"}],
                },
            }
        ]
    )

    with patch(f"src.agents.{agent_module_name}.ChatOpenAI") as mock_chat:
        mock_chat.return_value = _StubChatOpenAI(response)
        rendered = generate_a2ui_fn.func(_FakeRuntime())

    parsed = json.loads(rendered)
    assert "error" in parsed, (
        f"{agent_module_name}.generate_a2ui let a malformed root through "
        f"to the renderer: {parsed!r}. Expected a clean error response."
    )
    assert "root" in parsed["error"].lower(), (
        f"Error message should mention the missing root component; got "
        f"{parsed['error']!r}."
    )
