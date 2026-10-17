"""Tests for copilotkit_customize_config.

Covers https://github.com/CopilotKit/CopilotKit/issues/6941:
  the function must not mutate the caller's shared metadata dict.
Covers https://github.com/CopilotKit/CopilotKit/issues/7590:
  non-boolean emit_tool_calls warns and is treated as True.
"""

import logging

import pytest

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


class TestEmitToolCallsBoolean:
    """Non-boolean emit_tool_calls warns and is stored as True. False still suppresses."""

    @pytest.mark.parametrize(
        "value",
        ["SearchTool", ["SearchTool", "FetchTool"], 123, {"name": "SearchTool"}],
    )
    def test_non_bool_warns_and_is_treated_as_true(self, value, caplog):
        with caplog.at_level(logging.WARNING, logger="copilotkit.langgraph"):
            customized = copilotkit_customize_config(
                {},
                emit_tool_calls=value,  # type: ignore[arg-type]
            )

        assert customized["metadata"]["copilotkit:emit-tool-calls"] is True
        assert "FilterToolCallsMiddleware" in caplog.text
        assert "treated as True" in caplog.text

    def test_false_sets_false_without_warning(self, caplog):
        with caplog.at_level(logging.WARNING, logger="copilotkit.langgraph"):
            customized = copilotkit_customize_config({}, emit_tool_calls=False)

        assert customized["metadata"]["copilotkit:emit-tool-calls"] is False
        assert "FilterToolCallsMiddleware" not in caplog.text

    def test_true_sets_true_without_warning(self, caplog):
        with caplog.at_level(logging.WARNING, logger="copilotkit.langgraph"):
            customized = copilotkit_customize_config({}, emit_tool_calls=True)

        assert customized["metadata"]["copilotkit:emit-tool-calls"] is True
        assert "FilterToolCallsMiddleware" not in caplog.text

    def test_omitted_does_not_set_metadata(self, caplog):
        with caplog.at_level(logging.WARNING, logger="copilotkit.langgraph"):
            customized = copilotkit_customize_config({})

        assert "copilotkit:emit-tool-calls" not in customized["metadata"]
        assert "FilterToolCallsMiddleware" not in caplog.text
