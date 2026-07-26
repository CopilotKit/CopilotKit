"""Tests for non-secret config value persistence across multiple agent runs.

These tests verify the documented access pattern for NON-SECRET runtime
configuration — user preferences, session metadata, UI state — that is
published via ``useAgentContext`` and flows through
``state["copilotkit"]["context"]``.

This is the MODEL-VISIBLE channel.  ``CopilotKitMiddleware`` serializes all
values in this channel into the "App Context:" system message sent to the LLM
on every turn.  Values here appear in LLM provider logs.

FOR AUTHENTICATION TOKENS AND SECRETS — use the x-* configurable-header path:
  * Send ``x-copilotkit-auth`` from the frontend via ``<CopilotKit headers={{}}>``
  * Read ``(config.get("configurable") or {}).get("x-copilotkit-auth")`` in
    the graph node.
  * See ``sdk-python/tests/test_configurable_auth_header.py`` for the proof.
  * See ``showcase/shell-docs/src/content/docs/integrations/langgraph/auth.mdx``
    for the documentation.

The access pattern exercised here:

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])
    # iterate through entries to extract NON-SECRET values
"""


def test_agent_node_can_read_preference_from_context():
    """Agent node can read non-secret user-preference values from the
    useAgentContext channel (``state["copilotkit"]["context"]``)."""

    # Simulate the state structure that CopilotKitMiddleware produces when
    # the frontend calls useAgentContext({ value: { tone: "casual", ... } })
    state = {
        "messages": [{"type": "human", "content": "hello"}],
        "copilotkit": {
            "context": [
                {
                    "description": "User response preferences",
                    "value": {
                        "tone": "casual",
                        "expertise": "intermediate",
                        "responseLength": "concise",
                        "sessionId": "sess-abc",
                    },
                }
            ]
        },
    }

    # Documented pattern for non-secret config from configurable.mdx
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    tone = None
    session_id = None

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            tone = value.get("tone") or tone
            session_id = value.get("sessionId") or session_id

    assert tone == "casual"
    assert session_id == "sess-abc"


def test_preference_persists_across_multiple_runs():
    """Non-secret preference values remain accessible across multiple agent
    runs (simulated state updates — LLM is meant to see these on every turn).
    """

    state = {
        "messages": [{"type": "human", "content": "first message"}],
        "copilotkit": {
            "context": [
                {
                    "description": "User response preferences",
                    "value": {
                        "tone": "professional",
                        "expertise": "expert",
                        "sessionId": "sess-persistent-99",
                    },
                }
            ]
        },
    }

    for run_number in range(1, 4):
        copilotkit_state = state.get("copilotkit", {})
        context_entries = copilotkit_state.get("context", [])

        tone = None
        for entry in context_entries:
            value = entry.get("value", {})
            if isinstance(value, dict):
                tone = value.get("tone") or tone

        assert tone == "professional", (
            f"Run {run_number}: tone preference must persist across runs"
        )

        # Simulate state evolution
        state["messages"].append(
            {"type": "ai", "content": f"Response from run {run_number}"}
        )
        state["messages"].append(
            {"type": "human", "content": f"Follow-up {run_number}"}
        )


def test_context_with_multiple_entries():
    """Agent can extract preference values when multiple context entries exist."""

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
                    "description": "Session metadata",
                    "value": {
                        "sessionId": "sess-multi-123",
                        "uiTheme": "dark",
                    },
                },
            ]
        },
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    tone = None
    session_id = None
    ui_theme = None

    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            tone = value.get("tone") or tone
            session_id = value.get("sessionId") or session_id
            ui_theme = value.get("uiTheme") or ui_theme

    assert tone == "casual"
    assert session_id == "sess-multi-123"
    assert ui_theme == "dark"


def test_missing_context_returns_none():
    """Agent node gracefully handles missing context (no crash)."""

    state = {
        "messages": [{"type": "human", "content": "hello"}],
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    tone = None
    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            tone = value.get("tone") or tone

    assert tone is None


def test_empty_context_returns_none():
    """Agent node handles empty context list gracefully."""

    state = {
        "messages": [{"type": "human", "content": "hello"}],
        "copilotkit": {"context": []},
    }

    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    tone = None
    for entry in context_entries:
        value = entry.get("value", {})
        if isinstance(value, dict):
            tone = value.get("tone") or tone

    assert tone is None


def test_no_sensitive_keys_in_context_channel():
    """Guard: the App Context channel must not carry auth tokens or secrets.

    This mirrors the guard in test_context_integration.py — both files must
    agree that auth tokens do not belong in ``state["copilotkit"]["context"]``.
    """
    sensitive_patterns = {"auth", "token", "secret", "key", "password", "credential"}

    state = {
        "messages": [],
        "copilotkit": {
            "context": [
                {
                    "description": "User preferences — appropriate for App Context",
                    "value": {
                        "tone": "enthusiastic",
                        "expertise": "beginner",
                        "responseLength": "detailed",
                        "uiTheme": "dark",
                        "sessionId": "sess-safe-123",
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
                for pattern in sensitive_patterns:
                    assert pattern not in lower_k, (
                        f"Key '{k}' looks like a credential — "
                        f"do not put auth tokens in state['copilotkit']['context']. "
                        f"Use x-copilotkit-auth configurable header instead."
                    )
