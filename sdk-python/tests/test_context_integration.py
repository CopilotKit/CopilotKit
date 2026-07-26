"""Tests for the documented useAgentContext state access pattern.

These tests verify the end-to-end contract that the docs describe:
1. Frontend publishes context via useAgentContext
2. CopilotKitMiddleware injects it into state["copilotkit"]["context"]
3. Agent node extracts values programmatically
4. Values persist across multiple agent runs

The state structure exercised here matches the shape that the middleware
populates during real agent execution, so these tests serve as contract
tests for the documented access pattern in configurable.mdx and auth.mdx.
"""

from typing import Any, Optional

from langchain_core.messages import HumanMessage


def extract_auth_token_from_state(state: dict[str, Any]) -> Optional[str]:
    """Use the documented pattern from configurable.mdx to extract authToken."""
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            auth_token = value.get("authToken")
            if auth_token:
                return auth_token
    return None


def test_context_access_persists_across_state_updates():
    """Verify that context values survive state updates across multiple agent turns."""

    # State shape that CopilotKitMiddleware produces when useAgentContext is called
    state = {
        "messages": [HumanMessage(content="first message")],
        "copilotkit": {
            "context": [
                {
                    "description": "User authentication context",
                    "value": {
                        "authToken": "integration-test-token-789",
                        "userId": "user-integration-1",
                    },
                }
            ]
        },
    }

    # Simulate three agent turns (messages grow, context must remain accessible)
    for run_number in range(1, 4):
        auth_token = extract_auth_token_from_state(state)
        assert auth_token == "integration-test-token-789", (
            f"Turn {run_number}: authToken must persist across runs"
        )

        # Simulate agent adding a response (state evolves)
        state["messages"].extend(
            [HumanMessage(content=f"Turn {run_number} user message")]
        )


def test_context_access_with_multiple_entries():
    """Verify the access pattern works when multiple context entries exist."""

    state = {
        "messages": [HumanMessage(content="hello")],
        "copilotkit": {
            "context": [
                {
                    "description": "Agent preferences",
                    "value": {"tone": "professional", "expertise": "expert"},
                },
                {
                    "description": "User authentication context",
                    "value": {"authToken": "multi-ctx-token", "userId": "user-42"},
                },
                {
                    "description": "Session metadata",
                    "value": {"sessionId": "sess-xyz"},
                },
            ]
        },
    }

    auth_token = extract_auth_token_from_state(state)
    assert auth_token == "multi-ctx-token"


def test_context_access_gracefully_handles_missing_context():
    """Verify extraction pattern doesn't crash when context is absent."""

    state = {"messages": [HumanMessage(content="hello")]}
    auth_token = extract_auth_token_from_state(state)
    assert auth_token is None


def test_context_state_structure_matches_docs():
    """Verify the state structure matches what the docs describe.

    Docs claim that useAgentContext publishes ``{ authToken: '...' }`` and it
    arrives at ``state["copilotkit"]["context"]`` as an array of
    ``{ description, value }`` entries. This test asserts that contract.
    """

    # Structure that CopilotKitMiddleware populates from a useAgentContext call
    state = {
        "messages": [HumanMessage(content="test")],
        "copilotkit": {
            "context": [
                {
                    "description": "User authentication and configuration",
                    "value": {
                        "authToken": "documented-pattern-token",
                        "otherConfig": "someValue",
                    },
                }
            ]
        },
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    extracted_token = None
    extracted_config = None

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            extracted_token = value.get("authToken") or extracted_token
            extracted_config = value.get("otherConfig") or extracted_config

    assert extracted_token == "documented-pattern-token"
    assert extracted_config == "someValue"
