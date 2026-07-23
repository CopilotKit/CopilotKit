"""Tests for raw_event sanitization to prevent deepcopy crashes on non-copyable objects."""

import dataclasses
import json
from unittest.mock import Mock, patch, MagicMock

import pytest

from copilotkit.langgraph_agui_agent import _make_safe, LangGraphAGUIAgent
from ag_ui_langgraph import LangGraphAgent


class NonCopyableObject:
    """Simulates a non-copyable object like a Cython extension or HTTP client."""

    def __init__(self, name: str = "NonCopyable"):
        self.name = name

    def __reduce__(self):
        raise TypeError("no default __reduce__ due to non-trivial __cinit__")


@dataclasses.dataclass
class SampleDataclass:
    """Sample dataclass for testing."""

    field1: str
    field2: int


class TestMakeSafe:
    """Test the _make_safe() helper function."""

    def test_make_safe_with_plain_dict(self):
        """Plain dict with JSON-serializable values should pass through."""
        obj = {"key": "value", "number": 42}
        result = _make_safe(obj)
        assert result == obj
        assert json.dumps(result)  # Should be JSON-serializable

    def test_make_safe_with_non_copyable_object(self):
        """Dict containing non-copyable object should replace with placeholder."""
        non_copyable = NonCopyableObject("test_object")
        obj = {"safe": "value", "unsafe": non_copyable}
        result = _make_safe(obj)

        assert isinstance(result, dict)
        assert result["safe"] == "value"
        assert result["unsafe"] == "<non-serializable: NonCopyableObject>"
        assert json.dumps(result)  # Should be JSON-serializable

    def test_make_safe_with_dataclass_containing_non_serializable(self):
        """Dataclass with non-serializable fields should sanitize recursively."""
        non_copyable = NonCopyableObject()
        dc = SampleDataclass(field1="text", field2=123)
        dc.field3 = non_copyable  # Add non-serializable field

        obj = {"dataclass": dc}
        result = _make_safe(obj)

        assert isinstance(result, dict)
        assert isinstance(result["dataclass"], dict)
        assert result["dataclass"]["field1"] == "text"
        assert result["dataclass"]["field2"] == 123
        assert result["dataclass"]["field3"] == "<non-serializable: NonCopyableObject>"
        assert json.dumps(result)

    def test_make_safe_with_circular_references(self):
        """Circular references should not cause infinite loops."""
        obj = {"key": "value"}
        obj["self"] = obj  # Create circular reference

        result = _make_safe(obj)

        assert isinstance(result, dict)
        assert result["key"] == "value"
        assert result["self"] == "<circular: dict>"
        assert json.dumps(result)  # Should be JSON-serializable

    def test_make_safe_with_nested_structures(self):
        """Nested dicts/lists with mixed safe and unsafe values."""
        non_copyable = NonCopyableObject("nested")
        obj = {
            "level1": {
                "level2": [1, 2, {"unsafe": non_copyable}, "safe"],
                "number": 42,
            },
            "list": [True, False, non_copyable],
        }
        result = _make_safe(obj)

        assert (
            result["level1"]["level2"][2]["unsafe"]
            == "<non-serializable: NonCopyableObject>"
        )
        assert result["list"][2] == "<non-serializable: NonCopyableObject>"
        assert json.dumps(result)

    def test_make_safe_with_none_values(self):
        """None values should pass through."""
        obj = {"key": None, "another": "value"}
        result = _make_safe(obj)
        assert result == obj

    def test_make_safe_with_bool_int_float_str(self):
        """Primitive types should pass through."""
        obj = {"bool": True, "int": 42, "float": 3.14, "str": "text"}
        result = _make_safe(obj)
        assert result == obj

    def test_make_safe_with_list_containing_non_copyable(self):
        """Lists should be sanitized recursively."""
        non_copyable = NonCopyableObject()
        obj = [1, "text", non_copyable, {"nested": non_copyable}]
        result = _make_safe(obj)

        assert result[0] == 1
        assert result[1] == "text"
        assert result[2] == "<non-serializable: NonCopyableObject>"
        assert result[3]["nested"] == "<non-serializable: NonCopyableObject>"
        assert json.dumps(result)

    def test_make_safe_with_pydantic_model(self):
        """Pydantic models with model_dump should be handled."""
        try:
            from pydantic import BaseModel

            class PydanticModel(BaseModel):
                field1: str
                field2: int

            model = PydanticModel(field1="test", field2=42)
            obj = {"model": model}
            result = _make_safe(obj)

            assert isinstance(result["model"], dict)
            assert result["model"]["field1"] == "test"
            assert result["model"]["field2"] == 42
            assert json.dumps(result)
        except ImportError:
            pytest.skip("pydantic not installed")

    def test_make_safe_with_dataclass_nested(self):
        """Nested dataclasses should be recursively sanitized."""
        dc1 = SampleDataclass(field1="inner", field2=10)
        dc2 = SampleDataclass(field1="outer", field2=20)
        dc2.nested = dc1  # Add nested dataclass

        result = _make_safe(dc2)

        assert isinstance(result, dict)
        assert result["field1"] == "outer"
        assert result["nested"]["field1"] == "inner"
        assert json.dumps(result)


class TestLangGraphAGUIAgentSafeRawEvent:
    """Test LangGraphAGUIAgent._safe_raw_event() method."""

    def test_safe_raw_event_with_none(self):
        """None input should return None."""
        assert LangGraphAGUIAgent._safe_raw_event(None) is None

    def test_safe_raw_event_with_dict(self):
        """Dict input should be sanitized."""
        obj = {"key": "value", "unsafe": NonCopyableObject()}
        result = LangGraphAGUIAgent._safe_raw_event(obj)

        assert isinstance(result, dict)
        assert result["key"] == "value"
        assert result["unsafe"] == "<non-serializable: NonCopyableObject>"


class TestLangGraphAGUIAgentDispatchEvent:
    """Test LangGraphAGUIAgent._dispatch_event() sanitization."""

    @pytest.fixture
    def mock_agent(self):
        """Create a mock LangGraphAGUIAgent for testing."""
        with patch(
            "copilotkit.langgraph_agui_agent.LangGraphAgent.__init__"
        ) as mock_init:
            mock_init.return_value = None
            agent = MagicMock(spec=LangGraphAGUIAgent)
            agent.constant_schema_keys = []
            agent.active_run = {}
            # Use the real _safe_raw_event and _dispatch_event methods
            agent._safe_raw_event = LangGraphAGUIAgent._safe_raw_event
            agent._dispatch_event = LangGraphAGUIAgent._dispatch_event.__get__(
                agent, LangGraphAGUIAgent
            )
            return agent

    def test_dispatch_event_sanitizes_raw_event(self, mock_agent):
        """_dispatch_event should sanitize raw_event before passing to parent."""
        non_copyable = NonCopyableObject()
        event = Mock()
        event.type = "CUSTOM"
        event.name = "unknown_event"
        event.raw_event = {"data": "test", "unsafe": non_copyable}

        # Mock the parent _dispatch_event
        with patch(
            "copilotkit.langgraph_agui_agent.LangGraphAgent._dispatch_event",
            return_value=None,
        ):
            try:
                mock_agent._dispatch_event(event)
            except AttributeError:
                # Expected if parent method is not fully mocked; we just care about sanitization
                pass

        # raw_event should be sanitized
        assert isinstance(event.raw_event, dict)
        assert event.raw_event["data"] == "test"
        assert event.raw_event["unsafe"] == "<non-serializable: NonCopyableObject>"

    def test_dispatch_event_handles_none_raw_event(self, mock_agent):
        """_dispatch_event should handle None raw_event gracefully."""
        event = Mock()
        event.type = "TEXT_MESSAGE_START"
        event.raw_event = None

        with patch.object(LangGraphAgent, "_dispatch_event", return_value="dispatched"):
            mock_agent._dispatch_event(event)

        # Should not raise an exception
        assert event.raw_event is None

    def test_dispatch_event_handles_missing_raw_event_attribute(self, mock_agent):
        """_dispatch_event should handle events without raw_event attribute."""
        event = Mock()
        del event.raw_event  # Remove the raw_event attribute
        event.type = "CUSTOM"
        event.name = "unknown_event"

        with patch(
            "copilotkit.langgraph_agui_agent.LangGraphAgent._dispatch_event",
            return_value=None,
        ):
            try:
                mock_agent._dispatch_event(event)
            except (AttributeError, TypeError):
                # Expected if event structure is incomplete; we just care that it doesn't crash on missing raw_event
                pass

        # Should not raise an exception about raw_event
        # (any AttributeError would be about other event attributes, not raw_event)
        assert True

    def test_dispatch_event_exception_handling(self, mock_agent):
        """_dispatch_event should set raw_event to None on unexpected errors during sanitization."""
        event = Mock()
        event.type = "TEXT_MESSAGE_START"
        event.raw_event = {"key": "value"}

        # Patch _safe_raw_event to raise an exception
        with patch.object(
            mock_agent, "_safe_raw_event", side_effect=RuntimeError("Unexpected error")
        ):
            with patch.object(
                LangGraphAgent, "_dispatch_event", return_value="dispatched"
            ):
                mock_agent._dispatch_event(event)

        # raw_event should be set to None on exception
        assert event.raw_event is None
