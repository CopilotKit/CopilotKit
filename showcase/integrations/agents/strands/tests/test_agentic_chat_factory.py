"""Tests for the agentic-chat factory."""
import os
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")


def test_factory_returns_agent_with_canonical_name():
    from agents.agentic_chat import build_agentic_chat_agent
    agent = build_agentic_chat_agent()
    assert agent.name == "agentic-chat"


def test_factory_idempotent():
    from agents.agentic_chat import build_agentic_chat_agent
    a1 = build_agentic_chat_agent()
    a2 = build_agentic_chat_agent()
    assert a1 is not a2
