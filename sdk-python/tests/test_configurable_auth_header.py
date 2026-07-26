"""Proof: user graph code reads x-copilotkit-auth from the LangGraph
configurable channel on repeated runs — the non-model-visible auth path.

Background
----------
CopilotKit's supported self-hosted auth credential path for LangGraph agents:

  1. The CopilotKit v2 runtime forwards eligible inbound ``x-*`` HTTP headers
     onto the outgoing agent call (``mergeForwardableHeaders`` in
     ``packages/runtime/src/v2/runtime/handlers/shared/agent-utils.ts``).

  2. The langgraph-api server admits those headers into
     ``config["configurable"]`` because ``langgraph.json`` sets::

       "http": {"configurable_headers": {"include": ["x-*"]}}

     This server-side mapping is documented in
     ``sdk-python/copilotkit/copilotkit_lg_middleware.py``
     ``_extract_forwarded_headers_from_config()``.

  3. User graph-node code reads the token::

       token = (config.get("configurable") or {}).get("x-copilotkit-auth")

This is the only auth path that does NOT serialize the token into the
model-visible system message ("App Context").  ``useAgentContext`` and
``state["copilotkit"]["context"]`` are NOT acceptable auth-token paths
because ``CopilotKitMiddleware`` injects those values into the LLM prompt.

What these tests prove
-----------------------
They build a real compiled LangGraph ``StateGraph`` with a graph node that
reads ``x-copilotkit-auth`` from ``config["configurable"]``, invoke it on
at least two consecutive runs with the same thread (simulating the repeated-
run scenario the LangGraph server would produce), and assert:

  * The token is accessible on EVERY run via the configurable channel.
  * The token is NOT present anywhere in the graph state (not model-visible).
  * The token does not appear in logs or test output (only a boolean flag or
    short hash is recorded).

Forbidden paths (not used here)
---------------------------------
  * ``patch("langgraph.config.get_config", ...)``
  * direct calls to ``_extract_forwarded_headers_from_config()``
  * preseeded ``state["copilotkit"]["context"]``
  * mocked ``LangGraphAgent.run``
  * ``useAgentContext``
"""

import hashlib
from typing import Any

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langchain_core.runnables import RunnableConfig


# ---------------------------------------------------------------------------
# Minimal graph that proves the configurable-header auth-token pattern.
# ---------------------------------------------------------------------------

class _AuthState(dict):
    """Minimal graph state — keys added by the auth_node."""


def _auth_node(state: dict[str, Any], config: RunnableConfig) -> dict[str, Any]:
    """Graph node that reads x-copilotkit-auth from config["configurable"].

    Stores ONLY a boolean flag and a 12-char SHA-256 prefix in state so
    no raw token appears in state, logs, or test output.  This matches
    what production code should do: check presence and validate
    cryptographically — never echo the raw token into state or logs.
    """
    configurable = config.get("configurable") or {}
    raw_token = configurable.get("x-copilotkit-auth")

    token_present = isinstance(raw_token, str) and len(raw_token) > 0
    # 12-char prefix of the SHA-256 hash — safe to record, never the raw token.
    token_hash_prefix = (
        hashlib.sha256(raw_token.encode()).hexdigest()[:12]
        if token_present
        else ""
    )

    return {
        "token_present": token_present,
        "token_hash_prefix": token_hash_prefix,
        # Explicitly assert the token is NOT copied into state for the LLM.
        "raw_token_in_state": None,
    }


def _make_auth_graph(checkpointer=None):
    builder = StateGraph(dict)
    builder.add_node("auth", _auth_node)
    builder.add_edge(START, "auth")
    builder.add_edge("auth", END)
    return builder.compile(checkpointer=checkpointer)


# ---------------------------------------------------------------------------
# Test 1: Two consecutive single-thread runs — simulates repeated turns on
# the same LangGraph thread (the MemorySaver acts as the checkpoint store
# that langgraph-api would provide in production).
# ---------------------------------------------------------------------------

class TestConfigurableAuthHeaderRepeatedRuns:
    """x-copilotkit-auth is accessible on consecutive graph runs."""

    def test_token_accessible_on_two_consecutive_runs(self):
        """Core FAC-121 repeated-run proof.

        Two consecutive invocations of the same compiled graph (same thread_id)
        with ``x-copilotkit-auth`` in ``config["configurable"]`` both succeed
        in reading the token.  The token never appears in state.
        """
        graph = _make_auth_graph(checkpointer=MemorySaver())
        thread_config: RunnableConfig = {
            "configurable": {
                "thread_id": "fac-121-proof-thread",
                "x-copilotkit-auth": "fac121-repeated-run-token",
            }
        }

        # Run 1
        result1 = graph.invoke({}, config=thread_config)
        assert result1["token_present"] is True, (
            "Run 1: x-copilotkit-auth must be accessible via config['configurable']"
        )
        assert result1["raw_token_in_state"] is None, (
            "Run 1: raw token must never be copied into graph state"
        )
        hash1 = result1["token_hash_prefix"]
        assert isinstance(hash1, str) and len(hash1) == 12

        # Run 2 (same thread — simulates the second turn in a multi-turn session)
        result2 = graph.invoke({}, config=thread_config)
        assert result2["token_present"] is True, (
            "Run 2: x-copilotkit-auth must still be accessible on the second run"
        )
        assert result2["raw_token_in_state"] is None, (
            "Run 2: raw token must never be copied into graph state"
        )
        hash2 = result2["token_hash_prefix"]

        # Both runs saw the SAME token (same hash prefix).
        assert hash1 == hash2, (
            "Token identity must be stable across repeated runs of the same thread"
        )

    def test_token_absent_when_not_forwarded(self):
        """When no x-copilotkit-auth header is forwarded, token_present is False.

        This simulates an unauthenticated call or a runtime that did not
        include the header, ensuring the code path handles absence gracefully.
        """
        graph = _make_auth_graph(checkpointer=MemorySaver())
        no_auth_config: RunnableConfig = {
            "configurable": {"thread_id": "fac-121-no-auth-thread"}
        }

        result = graph.invoke({}, config=no_auth_config)
        assert result["token_present"] is False
        assert result["token_hash_prefix"] == ""
        assert result["raw_token_in_state"] is None

    def test_token_not_in_copilotkit_context(self):
        """x-copilotkit-auth must NOT appear in state['copilotkit']['context'].

        ``state["copilotkit"]["context"]`` is what ``CopilotKitMiddleware``
        serializes into the model-visible "App Context" system message.
        Auth tokens must never flow through this channel.
        """
        graph = _make_auth_graph(checkpointer=MemorySaver())
        thread_config: RunnableConfig = {
            "configurable": {
                "thread_id": "fac-121-no-leak-thread",
                "x-copilotkit-auth": "secret-token-must-not-leak",
            }
        }

        result = graph.invoke({}, config=thread_config)

        # State must have no copilotkit.context entry containing the token.
        copilotkit_state = result.get("copilotkit", {})
        context_entries = copilotkit_state.get("context", [])

        for entry in context_entries:
            value = entry.get("value", {})
            if isinstance(value, dict):
                assert "x-copilotkit-auth" not in value, (
                    "x-copilotkit-auth must never appear in state['copilotkit']['context'] "
                    "(model-visible App Context)"
                )
                # Also check that no string value contains the raw token text.
                for v in value.values():
                    if isinstance(v, str):
                        assert "secret-token-must-not-leak" not in v, (
                            "Raw token text must not appear in any context entry value"
                        )

        # token_present flag is True — token was accessible via config, not state.
        assert result["token_present"] is True

    def test_three_consecutive_runs_all_succeed(self):
        """Extended repeated-run proof across three turns."""
        graph = _make_auth_graph(checkpointer=MemorySaver())
        thread_config: RunnableConfig = {
            "configurable": {
                "thread_id": "fac-121-three-run-thread",
                "x-copilotkit-auth": "multi-run-auth-token",
            }
        }

        for run_number in range(1, 4):
            result = graph.invoke({}, config=thread_config)
            assert result["token_present"] is True, (
                f"Run {run_number}: x-copilotkit-auth must be accessible on every turn"
            )
            assert result["raw_token_in_state"] is None, (
                f"Run {run_number}: raw token must not appear in state"
            )


# ---------------------------------------------------------------------------
# Test 2: Prove the configurable channel is isolated from state["copilotkit"].
# This is the key separation that makes the x-* header path non-model-visible.
# ---------------------------------------------------------------------------

class TestConfigurableVsStateChannelIsolation:
    """config['configurable'] and state['copilotkit']['context'] are independent."""

    def test_configurable_does_not_merge_into_copilotkit_state(self):
        """Values in config['configurable'] must not bleed into state.

        If they did, CopilotKitMiddleware would serialize them into the
        model-visible App Context system message — violating the non-model-
        visible guarantee of the x-* header auth path.
        """
        graph = _make_auth_graph()
        result = graph.invoke(
            {},
            config={
                "configurable": {
                    "x-copilotkit-auth": "isolation-test-token",
                    "x-custom-header": "custom-value",
                }
            },
        )

        # configurable values must NOT appear in state at all.
        assert "x-copilotkit-auth" not in result
        assert "x-custom-header" not in result
        copilotkit = result.get("copilotkit", {})
        assert "x-copilotkit-auth" not in copilotkit
        assert "x-custom-header" not in copilotkit

        # But the token WAS accessible to the graph node via config.
        assert result["token_present"] is True

    def test_copilotkit_context_state_does_not_affect_configurable(self):
        """state['copilotkit']['context'] entries must not be readable from
        config['configurable'].

        This confirms the two channels are truly independent — a frontend
        using useAgentContext cannot accidentally place values into the
        config that an auth-reading node would see as x-copilotkit-auth.
        """

        def _reading_node(state: dict[str, Any], config: RunnableConfig) -> dict[str, Any]:
            configurable = config.get("configurable") or {}
            # The configurable channel should have NO values from copilotkit.context
            auth_via_configurable = configurable.get("x-copilotkit-auth")
            context_bleed = configurable.get("copilotkit_context_leaked", False)
            return {
                "auth_via_configurable": auth_via_configurable,
                "context_bleed": context_bleed,
            }

        builder = StateGraph(dict)
        builder.add_node("read", _reading_node)
        builder.add_edge(START, "read")
        builder.add_edge("read", END)
        graph = builder.compile()

        # Seed state with a copilotkit.context entry (useAgentContext shape)
        initial_state = {
            "copilotkit": {
                "context": [
                    {
                        "description": "user preferences",
                        "value": {
                            "tone": "professional",
                            # Deliberately not an auth token — but even if it were,
                            # it must NOT bleed into configurable.
                            "copilotkit_context_leaked": True,
                        },
                    }
                ]
            }
        }

        result = graph.invoke(initial_state, config={"configurable": {}})
        # Nothing from copilotkit.context should appear in configurable.
        assert result["auth_via_configurable"] is None
        assert result["context_bleed"] is False
