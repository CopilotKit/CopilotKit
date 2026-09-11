"""Tests for copilotkit_customize_config.

Issue #6941: copilotkit_customize_config must not mutate the caller's config["metadata"]
in place. The returned config must have its own isolated metadata dictionary.
"""

from copilotkit.langgraph import copilotkit_customize_config


def test_copilotkit_customize_config_does_not_mutate_caller_metadata():
    """copilotkit_customize_config must not write into the caller's config['metadata'].

    Bug #6941: .get("metadata", {}) returns the caller's actual dict object by
    reference. Before the fix, writing metadata["copilotkit:emit-messages"] = False
    corrupted every subsequent LLM call in the same node that used the original config.
    """
    original_config = {"metadata": {"some_key": "value"}}
    original_metadata_id = id(original_config["metadata"])

    modified = copilotkit_customize_config(original_config, emit_messages=False)

    # Original config must be completely untouched
    assert "copilotkit:emit-messages" not in original_config["metadata"]
    assert original_config["metadata"]["some_key"] == "value"
    # The returned config must have the new key
    assert modified["metadata"]["copilotkit:emit-messages"] is False
    # The two metadata dicts must be different objects
    assert id(modified["metadata"]) != original_metadata_id


def test_copilotkit_customize_config_does_not_mutate_caller_metadata_no_existing_metadata():
    """When the caller has no 'metadata' key, customize_config must still not add
    one to the original dict (it should only appear in the returned dict)."""
    original_config = {"configurable": {"thread_id": "t1"}}
    modified = copilotkit_customize_config(original_config, emit_messages=False)

    assert "metadata" not in original_config
    assert modified["metadata"]["copilotkit:emit-messages"] is False


def test_copilotkit_customize_config_with_none_base_config():
    """When base_config is None, customize_config returns a valid config dict with metadata."""
    modified = copilotkit_customize_config(
        None, emit_messages=False, emit_tool_calls=False
    )
    assert modified["metadata"]["copilotkit:emit-messages"] is False
    assert modified["metadata"]["copilotkit:emit-tool-calls"] is False


def test_copilotkit_customize_config_preserves_other_config_fields():
    """Ensure other config fields like tags, configurable, and callbacks are preserved."""
    original_config = {
        "configurable": {"thread_id": "thread-123"},
        "tags": ["agent", "production"],
        "metadata": {"user_id": "user-456"},
    }
    modified = copilotkit_customize_config(original_config, emit_messages=False)

    assert modified["configurable"] == {"thread_id": "thread-123"}
    assert modified["tags"] == ["agent", "production"]
    assert modified["metadata"]["user_id"] == "user-456"
    assert modified["metadata"]["copilotkit:emit-messages"] is False
    assert "copilotkit:emit-messages" not in original_config["metadata"]
