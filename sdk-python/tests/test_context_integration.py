"""Tests for the useAgentContext / state["copilotkit"]["context"] access pattern.

These tests verify the contract for NON-SECRET runtime configuration values
(user preferences, session IDs, UI metadata) that are deliberately shared with
the LLM via the model-visible App Context channel.

IMPORTANT: This is the WRONG channel for authentication tokens.
-----------------------------------------------------------------
``state["copilotkit"]["context"]`` is serialized by ``CopilotKitMiddleware``
into a "App Context:" system message that is sent to the LLM on every turn.
That means:
  * Values appear in LLM provider logs and billing records.
  * The LLM can read and reference them in its responses.
  * Anyone with access to LLM provider logs can see them.

Do NOT store auth tokens, API keys, or secrets in this channel.

For non-model-visible credential passing, use the ``x-copilotkit-auth``
configurable-header path instead — see
``sdk-python/tests/test_configurable_auth_header.py`` for the proof
and ``showcase/shell-docs/src/content/docs/integrations/langgraph/auth.mdx``
for the documentation.
"""

from typing import Any, Optional

from langchain_core.messages import HumanMessage


# ---------------------------------------------------------------------------
# Helper: extract a NON-SECRET config value from the App Context channel.
# This is the correct use of state["copilotkit"]["context"]: user preferences,
# tone settings, session metadata — values the LLM is MEANT to see.
# ---------------------------------------------------------------------------


def extract_user_preference_from_state(
    state: dict[str, Any], key: str
) -> Optional[str]:
    """Read a user-preference value from the useAgentContext channel.

    This is the documented access pattern for model-visible config (e.g.
    tone, expertise level, responseLength).  Do NOT use this pattern for
    auth tokens or secrets.
    """
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            result = value.get(key)
            if result is not None:
                return result
    return None


# ---------------------------------------------------------------------------
# Tests for the useAgentContext channel — non-secret config values only.
# ---------------------------------------------------------------------------


def test_user_preference_persists_across_state_updates():
    """User preference values survive simulated multi-turn state evolution.

    ``useAgentContext`` is appropriate for preferences because the LLM is
    meant to read and act on them (e.g. tone, expertise level).  The values
    are intentionally sent to the LLM via the App Context system message.
    """

    # State shape that CopilotKitMiddleware produces when useAgentContext is called
    state = {
        "messages": [HumanMessage(content="first message")],
        "copilotkit": {
            "context": [
                {
                    "description": "User response preferences",
                    "value": {
                        "tone": "professional",
                        "expertise": "expert",
                        "responseLength": "concise",
                    },
                }
            ]
        },
    }

    # Simulate three agent turns (messages grow, context must remain accessible)
    for turn in range(1, 4):
        tone = extract_user_preference_from_state(state, "tone")
        expertise = extract_user_preference_from_state(state, "expertise")
        assert tone == "professional", f"Turn {turn}: tone must persist"
        assert expertise == "expert", f"Turn {turn}: expertise must persist"

        # Simulate agent adding a response (state evolves)
        state["messages"].append(HumanMessage(content=f"Turn {turn} user message"))


def test_context_access_with_multiple_entries():
    """Access pattern works when multiple context entries exist."""

    state = {
        "messages": [HumanMessage(content="hello")],
        "copilotkit": {
            "context": [
                {
                    "description": "Agent preferences",
                    "value": {"tone": "professional", "expertise": "expert"},
                },
                {
                    "description": "Session metadata",
                    "value": {
                        "sessionId": "sess-xyz",
                        "responseLength": "detailed",
                    },
                },
            ]
        },
    }

    assert extract_user_preference_from_state(state, "tone") == "professional"
    assert extract_user_preference_from_state(state, "expertise") == "expert"
    assert extract_user_preference_from_state(state, "responseLength") == "detailed"
    assert extract_user_preference_from_state(state, "sessionId") == "sess-xyz"


def test_context_access_gracefully_handles_missing_context():
    """Extraction pattern does not crash when context is absent."""

    state = {"messages": [HumanMessage(content="hello")]}
    assert extract_user_preference_from_state(state, "tone") is None
    assert extract_user_preference_from_state(state, "expertise") is None


def test_context_state_structure_matches_docs():
    """State structure matches what the docs and middleware produce.

    ``useAgentContext`` publishes ``{ tone: '...', expertise: '...' }`` and it
    arrives at ``state["copilotkit"]["context"]`` as an array of
    ``{ description, value }`` entries.  This is the model-visible channel —
    appropriate for preferences, NOT for auth tokens.
    """

    state = {
        "messages": [HumanMessage(content="test")],
        "copilotkit": {
            "context": [
                {
                    "description": "User preferences",
                    "value": {
                        "tone": "casual",
                        "expertise": "beginner",
                        "responseLength": "detailed",
                    },
                }
            ]
        },
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    tone = None
    expertise = None
    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            tone = value.get("tone") or tone
            expertise = value.get("expertise") or expertise

    assert tone == "casual"
    assert expertise == "beginner"


def test_context_channel_does_not_contain_sensitive_keys():
    """Auth tokens must never be stored in the useAgentContext channel.

    This is an anti-pattern guard: if a caller accidentally puts a token-like
    value in copilotkit.context, it would be visible to the LLM.  Applications
    must route auth credentials through ``x-copilotkit-auth`` (configurable
    header) instead.

    This test serves as a documentation-level assertion that the App Context
    channel in these tests never carries sensitive key names.
    """
    sensitive_key_patterns = {
        "auth",
        "token",
        "secret",
        "key",
        "password",
        "credential",
    }

    state = {
        "messages": [],
        "copilotkit": {
            "context": [
                {
                    "description": "User preferences — appropriate for App Context",
                    "value": {
                        "tone": "professional",
                        "expertise": "expert",
                        "responseLength": "concise",
                        "sessionId": "sess-abc",
                    },
                }
            ]
        },
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            for k in value:
                lower_k = k.lower()
                for pattern in sensitive_key_patterns:
                    assert pattern not in lower_k, (
                        f"Key '{k}' looks like a credential — "
                        f"do not put auth tokens in state['copilotkit']['context']. "
                        f"Use x-copilotkit-auth configurable header instead."
                    )
