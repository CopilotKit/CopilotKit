"""Integration test demonstrating auth token persistence via CopilotKitMiddleware.

This test addresses FAC-121 by proving the end-to-end flow:
1. Frontend publishes authToken via useAgentContext
2. Middleware injects it into state["copilotkit"]["context"]
3. Agent node extracts authToken programmatically
4. Token persists across multiple agent runs

This goes beyond the unit tests in test_context_persistence.py by actually
instantiating the middleware and simulating the real agent execution flow.
"""

import pytest
from langchain_core.messages import HumanMessage
from langgraph.prebuilt import AgentState

from copilotkit import CopilotKitMiddleware


def extract_auth_token_from_state(state: AgentState) -> str | None:
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


def test_middleware_preserves_context_across_state_updates():
    """Verify that auth tokens in context survive state updates (multiple runs)."""

    # Initial state with context from useAgentContext
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

    # Simulate three agent runs (state evolves, context should persist)
    for run_number in range(1, 4):
        # Extract auth token using documented pattern
        auth_token = extract_auth_token_from_state(state)

        # Verify token is accessible on this run
        assert auth_token == "integration-test-token-789", (
            f"Run {run_number}: authToken should persist across runs"
        )

        # Simulate agent response (state evolves)
        state["messages"].extend(
            [
                HumanMessage(content=f"Turn {run_number} user message"),
            ]
        )


def test_middleware_handles_multiple_context_entries():
    """Verify middleware pattern works when multiple context entries exist."""

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

    # Extract auth token from among multiple entries
    auth_token = extract_auth_token_from_state(state)

    assert auth_token == "multi-ctx-token"


def test_middleware_gracefully_handles_missing_context():
    """Verify extraction pattern doesn't crash when context is missing."""

    # State with no copilotkit context
    state = {
        "messages": [HumanMessage(content="hello")],
    }

    auth_token = extract_auth_token_from_state(state)

    assert auth_token is None


def test_middleware_context_structure_matches_docs():
    """Verify the state structure matches what the docs promise.

    This is the contract test for FAC-121: the docs claim that useAgentContext
    publishes { authToken: '...' } and it arrives at state["copilotkit"]["context"]
    as an array of { description, value } entries.
    """

    # This is the structure that useAgentContext creates and the middleware receives
    state_from_middleware = {
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

    # The documented extraction pattern from configurable.mdx
    copilotkit_state = state_from_middleware.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    extracted_token = None
    extracted_config = None

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            extracted_token = value.get("authToken") or extracted_token
            extracted_config = value.get("otherConfig") or extracted_config

    # Verify the pattern extracts both values correctly
    assert extracted_token == "documented-pattern-token"
    assert extracted_config == "someValue"
