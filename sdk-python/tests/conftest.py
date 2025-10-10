"""
Shared test fixtures and utilities for CopilotKit tests.

SSOT for all test mocks and common setups.
Add new fixtures here to maintain DRY principle.
"""

import pytest
from unittest.mock import Mock, AsyncMock
from copilotkit.langgraph_agent import LangGraphAgent


# === Core Fixtures (used by all tests) ===

@pytest.fixture
def mock_graph():
    """
    Standard mock graph with aget_state.
    Override aget_state behavior in individual tests as needed.
    """
    graph = Mock()
    graph.aget_state = AsyncMock()
    return graph


@pytest.fixture
def agent(mock_graph):
    """Standard agent with mock graph."""
    return LangGraphAgent(
        name="test_agent",
        graph=mock_graph,
        langgraph_config={}
    )


# === Mock State Factories (SSOT for state structures) ===

def make_thread_state(thread_id, exists=True, **kwargs):
    """
    Factory for consistent thread state structure.

    Args:
        thread_id: Thread identifier
        exists: Whether thread has persisted state
        **kwargs: Additional state fields
    """
    if not exists:
        return Mock(values=None)

    values = {
        "thread_id": thread_id,
        "messages": kwargs.get("messages", []),
        **kwargs
    }
    return Mock(values=values)


def make_incremental_state(counter=0):
    """Factory for state that changes each call."""
    def _state_generator():
        nonlocal counter
        while True:
            counter += 1
            yield Mock(values={"counter": counter})

    gen = _state_generator()
    return lambda config: next(gen)


def make_thread_specific_state(thread_states):
    """
    Factory for thread-specific states.

    Args:
        thread_states: Dict mapping thread_id to state values
    """
    async def _get_state(config):
        thread_id = config.get("configurable", {}).get("thread_id")
        if thread_id in thread_states:
            return Mock(values=thread_states[thread_id])
        return Mock(values=None)
    return _get_state


# === Test Data Fixtures ===

@pytest.fixture
def empty_thread_state():
    """Standard empty thread state."""
    return make_thread_state("empty", exists=False)


@pytest.fixture
def persisted_thread_state():
    """Standard persisted thread state."""
    return make_thread_state(
        "persisted",
        exists=True,
        messages=["msg1", "msg2"],
        metadata={"created": "2024-01-01"}
    )