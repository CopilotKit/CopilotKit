"""Contracts for alpha-native forwarded props and context preparation."""

from pathlib import Path

from ag_ui.core import Context
from ag_ui_crewai import crewai_prepare_inputs


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"


def test_forwarded_props_and_context_reach_flow_state():
    state = crewai_prepare_inputs(
        state={"persisted": "wins"},
        messages=[],
        tools=[],
        context=[Context(description="Account tier", value="enterprise")],
        forwarded_props={"tone": "concise", "responseLength": "short"},
    )

    assert state["context"] == [{"description": "Account tier", "value": "enterprise"}]
    assert state["tone"] == "concise"
    assert state["response_length"] == "short"
    assert state["persisted"] == "wins"


def test_server_has_no_forwarded_props_body_rewrite():
    source = AGENT_SERVER.read_text()

    assert "ForwardedPropsASGIMiddleware" not in source
    assert "_splice_forwarded_props" not in source
