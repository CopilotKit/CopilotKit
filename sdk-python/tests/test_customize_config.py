"""Tests for copilotkit_customize_config.

Covers https://github.com/CopilotKit/CopilotKit/issues/6941:
  the function must not mutate the caller's shared metadata dict.
"""

from copilotkit.langgraph import copilotkit_customize_config


class TestCustomizeConfigDoesNotMutateCallerMetadata:
    """Regression: customize writes must not leak onto the input metadata."""

    def test_shared_metadata_dict_is_not_mutated(self):
        shared_metadata = {"user-key": "keep-me"}
        base_config = {
            "configurable": {"thread_id": "t-1"},
            "metadata": shared_metadata,
        }

        customized = copilotkit_customize_config(
            base_config,
            emit_messages=False,
            emit_tool_calls=False,
            emit_intermediate_state=[
                {"state_key": "steps", "tool": "SearchTool", "tool_argument": "steps"}
            ],
        )

        assert shared_metadata == {"user-key": "keep-me"}
        assert "copilotkit:emit-messages" not in shared_metadata
        assert "copilotkit:emit-tool-calls" not in shared_metadata
        assert "copilotkit:emit-intermediate-state" not in shared_metadata
        assert base_config["metadata"] is shared_metadata
        assert customized["metadata"] is not shared_metadata
        assert customized["metadata"]["user-key"] == "keep-me"
        assert customized["metadata"]["copilotkit:emit-messages"] is False
        assert customized["metadata"]["copilotkit:emit-tool-calls"] is False
        assert customized["metadata"]["copilotkit:emit-intermediate-state"] == [
            {"state_key": "steps", "tool": "SearchTool", "tool_argument": "steps"}
        ]
        assert base_config.get("metadata") == {"user-key": "keep-me"}

    def test_none_metadata_is_treated_as_empty_dict(self):
        customized = copilotkit_customize_config(
            {"metadata": None},
            emit_messages=False,
        )

        assert customized["metadata"]["copilotkit:emit-messages"] is False
        assert customized["metadata"] is not None

    def test_non_bool_emit_tool_calls_warns_and_is_treated_as_true(self, caplog):
        customized = copilotkit_customize_config(
            {},
            emit_tool_calls=["SearchTool"],  # type: ignore[arg-type]
        )

        assert customized["metadata"]["copilotkit:emit-tool-calls"] is True
        assert "FilterToolCallsMiddleware" in caplog.text
