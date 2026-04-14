"""Tests for #3690: LangGraphAGUIAgent stores Context as Pydantic objects instead of dicts."""

import json
from unittest.mock import MagicMock, patch
from ag_ui.core import Context


class TestAGUIContextSerialization:
    """Verify that context items stored in state are JSON-serializable dicts, not Pydantic objects."""

    def test_context_items_are_dicts_not_pydantic(self):
        """Context from ag-ui properties should be model_dump'd before storage."""
        from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent

        mock_graph = MagicMock()
        mock_graph.get_state = MagicMock()
        agent = LangGraphAGUIAgent(name="test", graph=mock_graph)

        # Pydantic Context objects as they arrive from AG-UI
        ctx1 = Context(name="user_info", description="User details", value="John")
        ctx2 = Context(name="session", description="Session data", value="abc123")

        merged_state = {
            'ag-ui': {
                'tools': [],
                'context': [ctx1, ctx2],
            },
            'messages': [],
        }

        with patch.object(
            type(agent).__mro__[1],  # LangGraphAgent (parent class)
            "langgraph_default_merge_state",
            return_value=merged_state
        ):
            result = agent.langgraph_default_merge_state({}, [], None)

        # Context items must be plain dicts, not Pydantic objects
        for item in result['copilotkit']['context']:
            assert isinstance(item, dict), f"Expected dict, got {type(item)}"
            json.dumps(item)  # Must be JSON-serializable

    def test_context_with_mixed_types(self):
        """If context contains both Pydantic objects and plain dicts, handle both."""
        from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent

        mock_graph = MagicMock()
        mock_graph.get_state = MagicMock()
        agent = LangGraphAGUIAgent(name="test", graph=mock_graph)

        ctx_pydantic = Context(name="key1", description="desc", value="val1")
        ctx_dict = {"name": "key2", "description": "desc2", "value": "val2"}

        merged_state = {
            'ag-ui': {
                'tools': [],
                'context': [ctx_pydantic, ctx_dict],
            },
            'messages': [],
        }

        with patch.object(
            type(agent).__mro__[1],
            "langgraph_default_merge_state",
            return_value=merged_state
        ):
            result = agent.langgraph_default_merge_state({}, [], None)

        for item in result['copilotkit']['context']:
            assert isinstance(item, dict), f"Expected dict, got {type(item)}"
            json.dumps(item)
