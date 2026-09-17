"""Tests for LangGraph configuration customization."""

from copilotkit.langgraph import copilotkit_customize_config


def test_customize_config_does_not_mutate_existing_metadata():
    """Emission settings must not leak back into the caller's config."""
    original_metadata = {"trace_id": "trace-123"}
    base_config = {"metadata": original_metadata}

    result = copilotkit_customize_config(base_config, emit_messages=False)

    assert base_config == {"metadata": {"trace_id": "trace-123"}}
    assert result["metadata"] == {
        "trace_id": "trace-123",
        "copilotkit:emit-messages": False,
    }
    assert result["metadata"] is not original_metadata
