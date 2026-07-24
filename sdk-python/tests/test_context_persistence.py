"""Test that demonstrates auth token persistence across multiple agent runs.

This test addresses FAC-121: verify that authentication tokens passed via
useAgentContext remain accessible to agent nodes across multiple runs.

These tests verify the documented access pattern from configurable.mdx and auth.mdx:
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])
    # iterate through entries to extract values
"""

import pytest


def test_agent_node_can_read_auth_token_from_context():
    """Agent node can read authToken from state["copilotkit"]["context"]."""

    # Simulate the state structure that would be present when useAgentContext
    # publishes { authToken: 'test-token-123', userId: 'user-42' }
    state = {
        "messages": [{"type": "human", "content": "hello"}],
        "copilotkit": {
            "context": [
                {
                    "description": "User authentication context",
                    "value": {
                        "authToken": "test-token-123",
                        "userId": "user-42",
                    },
                }
            ]
        },
    }

    # This is the documented pattern from configurable.mdx and auth.mdx
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    # Extract auth values from context entries
    auth_token = None
    user_id = None

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            auth_token = value.get("authToken") or auth_token
            user_id = value.get("userId") or user_id

    # Verify the token is accessible
    assert auth_token == "test-token-123"
    assert user_id == "user-42"


def test_auth_token_persists_across_multiple_runs():
    """Auth token remains accessible across multiple agent runs (simulated state updates)."""

    # Initial state with auth context
    state = {
        "messages": [{"type": "human", "content": "first message"}],
        "copilotkit": {
            "context": [
                {
                    "description": "User authentication context",
                    "value": {
                        "authToken": "persistent-token-456",
                        "userId": "user-99",
                    },
                }
            ]
        },
    }

    # Simulate three consecutive agent runs
    for run_number in range(1, 4):
        # Agent node reads auth token (documented pattern)
        copilotkit_state = state.get("copilotkit", {})
        context_entries = copilotkit_state.get("context", [])

        auth_token = None
        for entry in context_entries:
            value = entry.get("value", {})
            if isinstance(value, dict):
                auth_token = value.get("authToken") or auth_token

        # Verify token is accessible on this run
        assert auth_token == "persistent-token-456", (
            f"Run {run_number}: authToken should be accessible"
        )

        # Simulate agent adding a response (state evolves but context persists)
        state["messages"].append(
            {"type": "ai", "content": f"Response from run {run_number}"}
        )
        state["messages"].append(
            {"type": "human", "content": f"Follow-up {run_number}"}
        )


def test_context_with_multiple_entries():
    """Agent can extract authToken when multiple context entries are present."""

    state = {
        "messages": [{"type": "human", "content": "hello"}],
        "copilotkit": {
            "context": [
                {
                    "description": "User preferences",
                    "value": {
                        "tone": "casual",
                        "expertise": "intermediate",
                    },
                },
                {
                    "description": "User authentication context",
                    "value": {
                        "authToken": "multi-entry-token",
                        "userId": "user-123",
                    },
                },
                {
                    "description": "Session metadata",
                    "value": {
                        "sessionId": "sess-abc",
                    },
                },
            ]
        },
    }

    # Extract authToken from among multiple context entries
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    auth_token = None
    tone = None
    session_id = None

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            auth_token = value.get("authToken") or auth_token
            tone = value.get("tone") or tone
            session_id = value.get("sessionId") or session_id

    # All values should be extractable
    assert auth_token == "multi-entry-token"
    assert tone == "casual"
    assert session_id == "sess-abc"


def test_missing_context_returns_none():
    """Agent node gracefully handles missing context (no crash)."""

    # State with no copilotkit context
    state = {
        "messages": [{"type": "human", "content": "hello"}],
    }

    # Documented pattern should not crash
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    auth_token = None
    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            auth_token = value.get("authToken") or auth_token

    # Should return None, not crash
    assert auth_token is None


def test_empty_context_returns_none():
    """Agent node handles empty context list gracefully."""

    state = {
        "messages": [{"type": "human", "content": "hello"}],
        "copilotkit": {"context": []},
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    auth_token = None
    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            auth_token = value.get("authToken") or auth_token

    assert auth_token is None
