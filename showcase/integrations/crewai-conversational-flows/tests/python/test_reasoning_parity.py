"""Contracts for the alpha bridge's native reasoning Flow route."""

from pathlib import Path


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"
CONVERSATIONAL_FLOWS = INTEGRATION_ROOT / "src" / "agents" / "conversational_flows.py"
REASONING_FLOW = INTEGRATION_ROOT / "src" / "agents" / "reasoning_flow.py"


def test_server_registers_native_reasoning_flow():
    source = AGENT_SERVER.read_text()
    conversational_source = CONVERSATIONAL_FLOWS.read_text()

    assert "reasoning_app" not in source
    assert "CONVERSATIONAL_FLOW_TYPES" in source
    assert 'f"/conversational_flows/{feature}"' in source
    assert '"reasoning": _conversational_type(ReasoningFlow)' in conversational_source


def test_reasoning_flow_delegates_event_translation_to_alpha_bridge():
    source = REASONING_FLOW.read_text()

    assert "copilotkit_stream" in source
    assert "copilotkit_responses" in source
    assert "ReasoningMessageStartEvent" not in source
    assert "ReasoningMessageContentEvent" not in source
    assert "ReasoningMessageEndEvent" not in source
