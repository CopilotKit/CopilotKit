"""Tests that display_flight returns human-readable data alongside A2UI operations.

These tests exercise `display_flight` and `_build_flight_operations` in
isolation, without importing the full agent module (which pulls in heavy
ADK / AG-UI / pydantic dependencies). We import just the two functions
we need by loading the source file directly and extracting them.
"""

from __future__ import annotations

import importlib
import json
import sys
import types
from pathlib import Path
from unittest import mock


class FakeToolContext:
    def __init__(self):
        self.state = {}


def _load_display_flight():
    """Load display_flight and _build_flight_operations without importing the
    entire a2ui_fixed_agent module (which triggers LlmAgent validation).

    Strategy: read the source file, compile it, exec it in a namespace that
    provides lightweight stubs for the module-level imports, then pull out
    the two functions we care about.
    """
    src_dir = Path(__file__).resolve().parent.parent.parent / "src"
    agent_file = src_dir / "agents" / "a2ui_fixed_agent.py"
    source = agent_file.read_text()

    # Build a namespace with minimal stubs
    ns = {"__name__": "agents.a2ui_fixed_agent", "__file__": str(agent_file)}

    # Provide builtins
    import builtins
    ns["__builtins__"] = builtins

    # Stub out imports the module needs
    # json / Path / Any are real
    ns["json"] = json
    ns["Path"] = Path
    ns["Any"] = object  # typing.Any placeholder

    # Stub the heavy imports by pre-injecting them
    stub_ag_ui_adk = types.ModuleType("ag_ui_adk")
    stub_ag_ui_adk.AGUIToolset = lambda: None

    stub_google_adk_agents = types.ModuleType("google.adk.agents")
    # LlmAgent must accept **kwargs and be a no-op
    stub_google_adk_agents.LlmAgent = lambda **kw: None

    stub_google_adk_tools = types.ModuleType("google.adk.tools")
    stub_google_adk_tools.ToolContext = FakeToolContext

    stub_shared_chat = types.ModuleType("agents.shared_chat")
    stub_shared_chat.get_model = lambda: "gemini-2.0-flash"
    stub_shared_chat.stop_on_terminal_text = None
    stub_shared_chat.prevent_duplicate_tool_calls = None

    # Temporarily inject stubs
    saved = {}
    stubs = {
        "ag_ui_adk": stub_ag_ui_adk,
        "google.adk.agents": stub_google_adk_agents,
        "google.adk.tools": stub_google_adk_tools,
        "agents.shared_chat": stub_shared_chat,
    }
    # Also need google / google.adk parent modules
    for parent in ("google", "google.adk"):
        if parent not in sys.modules:
            stubs[parent] = types.ModuleType(parent)

    for name, mod in stubs.items():
        saved[name] = sys.modules.get(name)
        sys.modules[name] = mod

    try:
        code = compile(source, str(agent_file), "exec")
        exec(code, ns)  # noqa: S102
    finally:
        # Restore sys.modules
        for name, original in saved.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

    return ns["display_flight"]


display_flight = _load_display_flight()


def test_display_flight_returns_human_readable_result():
    ctx = FakeToolContext()
    result = display_flight(
        ctx, origin="SFO", destination="JFK", airline="United", price="$289"
    )
    assert "result" in result, "display_flight must return a 'result' key"
    assert isinstance(result["result"], str)
    assert "SFO" in result["result"]
    assert "JFK" in result["result"]


def test_display_flight_still_has_a2ui_operations():
    ctx = FakeToolContext()
    result = display_flight(
        ctx, origin="SFO", destination="JFK", airline="United", price="$289"
    )
    assert "a2ui_operations" in result
    assert isinstance(result["a2ui_operations"], list)
    assert len(result["a2ui_operations"]) >= 3


def test_display_flight_result_mentions_airline_and_price():
    ctx = FakeToolContext()
    result = display_flight(
        ctx, origin="LAX", destination="ORD", airline="Delta", price="$199"
    )
    summary = result["result"]
    assert "Delta" in summary
    assert "$199" in summary or "199" in summary
