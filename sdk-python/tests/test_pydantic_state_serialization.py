"""Tests for Pydantic BaseModel state serialization in LangGraphAgent.

Covers the bug reported in https://github.com/CopilotKit/CopilotKit/issues/2158:
  Pydantic BaseModel instances in LangGraph state crash langchain_dumps
  because they are not JSON-serializable by default.

Two code paths are tested:
  1. _emit_state_sync_event — the streaming state sync (originally fixed)
  2. get_state — the REST state retrieval (missed in the original fix)
"""

import json
import asyncio
import pytest
from unittest.mock import MagicMock, AsyncMock, patch, PropertyMock
from typing import List, Optional

from copilotkit.langgraph_agent import LangGraphAgent, _serialize_state


# ---------------------------------------------------------------------------
# Helpers: lightweight Pydantic model stubs
# ---------------------------------------------------------------------------

try:
    from pydantic import BaseModel as PydanticBaseModel
except ImportError:
    pytest.skip("pydantic not installed", allow_module_level=True)


class Address(PydanticBaseModel):
    street: str
    city: str


class UserProfile(PydanticBaseModel):
    name: str
    age: int
    address: Optional[Address] = None
    tags: List[str] = []


# ---------------------------------------------------------------------------
# Unit tests for the _serialize_state helper
# ---------------------------------------------------------------------------

class TestSerializeState:
    """Low-level tests for the recursive _serialize_state function."""

    def test_plain_dict_unchanged(self):
        state = {"key": "value", "count": 42}
        assert _serialize_state(state) == state

    def test_pydantic_model_converted_to_dict(self):
        model = UserProfile(name="Alice", age=30, tags=["admin"])
        result = _serialize_state(model)
        assert isinstance(result, dict)
        assert result == {"name": "Alice", "age": 30, "address": None, "tags": ["admin"]}

    def test_nested_pydantic_model(self):
        model = UserProfile(
            name="Bob",
            age=25,
            address=Address(street="123 Main St", city="Springfield"),
        )
        result = _serialize_state(model)
        assert isinstance(result, dict)
        assert result["address"] == {"street": "123 Main St", "city": "Springfield"}

    def test_dict_containing_pydantic_values(self):
        state = {
            "user": UserProfile(name="Carol", age=40),
            "count": 5,
        }
        result = _serialize_state(state)
        assert isinstance(result["user"], dict)
        assert result["user"]["name"] == "Carol"
        assert result["count"] == 5

    def test_list_of_pydantic_models(self):
        models = [UserProfile(name="A", age=1), UserProfile(name="B", age=2)]
        result = _serialize_state(models)
        assert all(isinstance(r, dict) for r in result)
        assert result[0]["name"] == "A"
        assert result[1]["name"] == "B"

    def test_tuple_preserved(self):
        state = (UserProfile(name="T", age=0),)
        result = _serialize_state(state)
        assert isinstance(result, tuple)
        assert result[0] == {"name": "T", "age": 0, "address": None, "tags": []}

    def test_deeply_nested_structure(self):
        state = {
            "level1": {
                "level2": [
                    {"model": UserProfile(name="Deep", age=99)}
                ]
            }
        }
        result = _serialize_state(state)
        assert result["level1"]["level2"][0]["model"]["name"] == "Deep"

    def test_none_passthrough(self):
        assert _serialize_state(None) is None

    def test_primitive_passthrough(self):
        assert _serialize_state(42) == 42
        assert _serialize_state("hello") == "hello"
        assert _serialize_state(True) is True


# ---------------------------------------------------------------------------
# Helpers for LangGraphAgent integration tests
# ---------------------------------------------------------------------------

def _make_agent():
    """Create a LangGraphAgent with a mocked graph for testing."""
    mock_graph = MagicMock()
    mock_graph.nodes = MagicMock()
    mock_graph.nodes.keys.return_value = ["agent"]
    mock_graph.config = {}
    # Raise so get_schema_keys returns None (no filtering), allowing all state keys through
    mock_graph.get_input_jsonschema = MagicMock(side_effect=Exception("no schema"))
    mock_graph.get_output_jsonschema = MagicMock(side_effect=Exception("no schema"))

    agent = LangGraphAgent(name="test_agent", graph=mock_graph)
    # Simulate what _stream_events does: set schema keys so filter_state_on_schema_keys
    # returns state unchanged (None means "no filtering")
    agent.output_schema_keys = None
    agent.input_schema_keys = None
    return agent


# ---------------------------------------------------------------------------
# Integration: _emit_state_sync_event (the originally fixed path)
# ---------------------------------------------------------------------------

class TestEmitStateSyncEvent:
    """Verify _emit_state_sync_event handles Pydantic state without crashing."""

    def test_pydantic_state_serializes_without_error(self):
        agent = _make_agent()
        state = {
            "user": UserProfile(name="Alice", age=30),
            "count": 1,
        }
        # This would raise if Pydantic models are not converted before langchain_dumps
        result = agent._emit_state_sync_event(
            thread_id="t-1",
            run_id="r-1",
            node_name="agent",
            state=state,
            running=True,
            active=True,
        )
        parsed = json.loads(result)
        assert parsed["event"] == "on_copilotkit_state_sync"
        assert parsed["state"]["user"]["name"] == "Alice"
        assert isinstance(parsed["state"]["user"], dict)

    def test_nested_pydantic_state_serializes(self):
        agent = _make_agent()
        state = {
            "profile": UserProfile(
                name="Bob",
                age=25,
                address=Address(street="1st Ave", city="NYC"),
            ),
        }
        result = agent._emit_state_sync_event(
            thread_id="t-2",
            run_id="r-2",
            node_name="agent",
            state=state,
            running=True,
            active=True,
        )
        parsed = json.loads(result)
        assert parsed["state"]["profile"]["address"]["city"] == "NYC"

    def test_plain_dict_state_still_works(self):
        agent = _make_agent()
        state = {"simple": "value", "number": 42}
        result = agent._emit_state_sync_event(
            thread_id="t-3",
            run_id="r-3",
            node_name="agent",
            state=state,
            running=False,
            active=False,
        )
        parsed = json.loads(result)
        assert parsed["state"]["simple"] == "value"


# ---------------------------------------------------------------------------
# Integration: get_state (the missed path — FAILS without the fix)
# ---------------------------------------------------------------------------

class TestGetState:
    """Verify get_state handles Pydantic state without crashing.

    This is the code path that was missed in the original fix.
    Without _serialize_state in get_state, the return value would contain
    raw Pydantic models that cannot be JSON-serialized downstream.
    """

    def test_pydantic_state_returned_as_dicts(self):
        agent = _make_agent()
        # Pre-populate thread_state with Pydantic models (simulating aget_state result)
        agent.thread_state["thread-1"] = {
            "messages": [],
            "user": UserProfile(name="Alice", age=30),
        }

        result = asyncio.get_event_loop().run_until_complete(
            agent.get_state(thread_id="thread-1")
        )

        assert result["threadExists"] is True
        # The state must contain plain dicts, not Pydantic models
        assert isinstance(result["state"]["user"], dict)
        assert result["state"]["user"]["name"] == "Alice"
        assert result["state"]["user"]["age"] == 30
        # Verify it's actually JSON-serializable
        json.dumps(result)

    def test_nested_pydantic_in_get_state(self):
        agent = _make_agent()
        agent.thread_state["thread-2"] = {
            "messages": [],
            "profile": UserProfile(
                name="Bob",
                age=25,
                address=Address(street="Oak Rd", city="Portland"),
            ),
        }

        result = asyncio.get_event_loop().run_until_complete(
            agent.get_state(thread_id="thread-2")
        )

        assert isinstance(result["state"]["profile"], dict)
        assert result["state"]["profile"]["address"]["city"] == "Portland"
        json.dumps(result)

    def test_list_of_pydantic_models_in_get_state(self):
        agent = _make_agent()
        agent.thread_state["thread-3"] = {
            "messages": [],
            "users": [
                UserProfile(name="A", age=1),
                UserProfile(name="B", age=2),
            ],
        }

        result = asyncio.get_event_loop().run_until_complete(
            agent.get_state(thread_id="thread-3")
        )

        assert all(isinstance(u, dict) for u in result["state"]["users"])
        json.dumps(result)

    def test_plain_dict_state_in_get_state(self):
        agent = _make_agent()
        agent.thread_state["thread-4"] = {
            "messages": [],
            "simple": "data",
        }

        result = asyncio.get_event_loop().run_until_complete(
            agent.get_state(thread_id="thread-4")
        )

        assert result["state"]["simple"] == "data"
        json.dumps(result)

    def test_empty_thread_returns_empty_state(self):
        agent = _make_agent()

        result = asyncio.get_event_loop().run_until_complete(
            agent.get_state(thread_id="")
        )

        assert result["threadExists"] is False
        assert result["state"] == {}
