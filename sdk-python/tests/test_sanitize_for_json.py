"""Tests for _sanitize_for_json in langgraph_agent.py.

Covers the NaN/Infinity sanitization fix for issue #1955:
  - Valid floats, ints, strings, booleans, None pass through unchanged
  - NaN and +/-Infinity are replaced with None
  - Sanitization recurses into dicts, lists, and tuples
  - Nested structures with mixed valid/invalid values are handled correctly
"""

import math

from copilotkit.langgraph_agent import _sanitize_for_json


class TestSanitizePassthrough:
    """Values that should pass through unchanged."""

    def test_regular_float(self):
        assert _sanitize_for_json(3.14) == 3.14

    def test_zero_float(self):
        assert _sanitize_for_json(0.0) == 0.0

    def test_negative_float(self):
        assert _sanitize_for_json(-1.5) == -1.5

    def test_integer(self):
        assert _sanitize_for_json(42) == 42

    def test_string(self):
        assert _sanitize_for_json("hello") == "hello"

    def test_boolean_true(self):
        assert _sanitize_for_json(True) is True

    def test_boolean_false(self):
        assert _sanitize_for_json(False) is False

    def test_none(self):
        assert _sanitize_for_json(None) is None

    def test_empty_dict(self):
        assert _sanitize_for_json({}) == {}

    def test_empty_list(self):
        assert _sanitize_for_json([]) == []

    def test_dict_with_valid_values(self):
        data = {"a": 1, "b": "two", "c": 3.0, "d": None, "e": True}
        assert _sanitize_for_json(data) == data

    def test_list_with_valid_values(self):
        data = [1, "two", 3.0, None, True]
        assert _sanitize_for_json(data) == data


class TestSanitizeNanInfinity:
    """NaN and Infinity values must be replaced with None."""

    def test_nan_becomes_none(self):
        assert _sanitize_for_json(float("nan")) is None

    def test_positive_infinity_becomes_none(self):
        assert _sanitize_for_json(float("inf")) is None

    def test_negative_infinity_becomes_none(self):
        assert _sanitize_for_json(float("-inf")) is None

    def test_math_nan_becomes_none(self):
        assert _sanitize_for_json(math.nan) is None

    def test_math_inf_becomes_none(self):
        assert _sanitize_for_json(math.inf) is None


class TestSanitizeNestedStructures:
    """Sanitization must recurse into nested dicts and lists."""

    def test_nan_in_dict_value(self):
        result = _sanitize_for_json({"score": float("nan")})
        assert result == {"score": None}

    def test_inf_in_dict_value(self):
        result = _sanitize_for_json({"score": float("inf")})
        assert result == {"score": None}

    def test_nan_in_list(self):
        result = _sanitize_for_json([1.0, float("nan"), 3.0])
        assert result == [1.0, None, 3.0]

    def test_nan_in_tuple(self):
        result = _sanitize_for_json((1.0, float("nan"), 3.0))
        assert result == [1.0, None, 3.0]

    def test_deeply_nested_nan(self):
        data = {
            "outer": {
                "inner": {
                    "values": [1.0, float("nan"), {"deep": float("inf")}]
                }
            }
        }
        result = _sanitize_for_json(data)
        assert result == {
            "outer": {
                "inner": {
                    "values": [1.0, None, {"deep": None}]
                }
            }
        }

    def test_mixed_valid_and_invalid_in_dict(self):
        data = {
            "valid_int": 42,
            "valid_str": "hello",
            "nan_val": float("nan"),
            "inf_val": float("inf"),
            "neg_inf_val": float("-inf"),
            "valid_float": 3.14,
            "nested": {"also_nan": float("nan"), "ok": True},
        }
        result = _sanitize_for_json(data)
        assert result == {
            "valid_int": 42,
            "valid_str": "hello",
            "nan_val": None,
            "inf_val": None,
            "neg_inf_val": None,
            "valid_float": 3.14,
            "nested": {"also_nan": None, "ok": True},
        }


class TestSanitizeEventLikeStructures:
    """Simulate real LangGraph event structures to ensure they're sanitized.

    These tests verify that the kind of data flowing through the event stream
    (line 507 in langgraph_agent.py) is properly sanitized before JSON serialization.
    Without sanitization, langchain_dumps() would raise ValueError for NaN/Infinity.
    """

    def test_event_with_nan_in_data_output(self):
        """Simulates an on_chain_end event where output state contains NaN."""
        event = {
            "event": "on_chain_end",
            "name": "agent_node",
            "run_id": "abc-123",
            "metadata": {},
            "data": {
                "output": {
                    "score": float("nan"),
                    "result": "success",
                    "confidence": float("inf"),
                }
            },
        }
        result = _sanitize_for_json(event)
        assert result["data"]["output"]["score"] is None
        assert result["data"]["output"]["confidence"] is None
        assert result["data"]["output"]["result"] == "success"
        assert result["event"] == "on_chain_end"

    def test_event_with_nan_in_streaming_chunk(self):
        """Simulates a streaming event where a chunk contains NaN values."""
        event = {
            "event": "on_chat_model_stream",
            "name": "model",
            "run_id": "def-456",
            "metadata": {"copilotkit:emit-intermediate-state": True},
            "data": {
                "chunk": {
                    "content": "",
                    "tool_call_chunks": [
                        {
                            "args": '{"temperature": NaN}',
                            "score": float("nan"),
                        }
                    ],
                }
            },
        }
        result = _sanitize_for_json(event)
        assert result["data"]["chunk"]["tool_call_chunks"][0]["score"] is None
        # String "NaN" inside args is NOT a float, so it stays as-is
        assert result["data"]["chunk"]["tool_call_chunks"][0]["args"] == '{"temperature": NaN}'

    def test_event_with_no_problematic_values_unchanged(self):
        """Normal events with no NaN/Infinity should pass through with same structure."""
        event = {
            "event": "on_chain_start",
            "name": "agent_node",
            "run_id": "ghi-789",
            "metadata": {"key": "value"},
            "data": {"input": {"query": "hello", "count": 5}},
        }
        result = _sanitize_for_json(event)
        assert result == event

    def test_state_sync_payload_with_nan(self):
        """Simulates the state dict passed to _emit_state_sync_event."""
        state = {
            "messages": [],
            "score": float("nan"),
            "embedding": [0.1, float("inf"), 0.3, float("-inf")],
            "metadata": {"loss": float("nan"), "accuracy": 0.95},
        }
        result = _sanitize_for_json(state)
        assert result["score"] is None
        assert result["embedding"] == [0.1, None, 0.3, None]
        assert result["metadata"]["loss"] is None
        assert result["metadata"]["accuracy"] == 0.95
