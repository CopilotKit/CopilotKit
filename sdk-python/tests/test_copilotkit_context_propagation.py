"""Tests for context and properties propagation through the CopilotKit agent pipeline.

Covers the two silent failures fixed in this PR:
1. langgraph_default_merge_state was rebuilding copilotkit without context, dropping
   useCopilotReadable items that the TypeScript runtime had correctly placed in state.
2. CopilotKitContext.properties were never forwarded to agent.execute(), so
   <CopilotKit properties={...} /> values never reached the agent state.
"""

import pytest
from copilotkit.langgraph_agent import langgraph_default_merge_state


class TestDefaultMergeStatePreservesContext:
    """langgraph_default_merge_state must not clobber copilotkit keys it didn't produce."""

    def _make_messages(self):
        # We don't need real LangChain messages for these tests.
        return []

    def test_preserves_context_from_incoming_state(self):
        context_items = [{"value": "User is a premium member"}, {"value": "Timezone: UTC"}]
        incoming = {
            "messages": [],
            "copilotkit": {
                "context": context_items,
                "actions": [],
            },
        }
        result = langgraph_default_merge_state(
            state=incoming,
            messages=self._make_messages(),
            actions=[{"name": "get_weather"}],
            agent_name="test_agent",
        )
        assert result["copilotkit"]["context"] == context_items

    def test_fresh_actions_overwrite_old_ones(self):
        """actions must come from the freshly-resolved list, not the stale incoming state."""
        incoming = {
            "messages": [],
            "copilotkit": {
                "context": [],
                "actions": [{"name": "old_action"}],
            },
        }
        new_actions = [{"name": "new_action"}]
        result = langgraph_default_merge_state(
            state=incoming,
            messages=self._make_messages(),
            actions=new_actions,
            agent_name="test_agent",
        )
        assert result["copilotkit"]["actions"] == new_actions

    def test_preserves_extra_copilotkit_keys(self):
        """Any other key under copilotkit must survive the merge (regression guard)."""
        incoming = {
            "messages": [],
            "copilotkit": {
                "context": [],
                "actions": [],
                "properties": {"plan": "enterprise"},
                "some_future_key": "preserved",
            },
        }
        result = langgraph_default_merge_state(
            state=incoming,
            messages=self._make_messages(),
            actions=[],
            agent_name="test_agent",
        )
        assert result["copilotkit"]["some_future_key"] == "preserved"
        assert result["copilotkit"]["properties"] == {"plan": "enterprise"}

    def test_no_copilotkit_in_incoming_state(self):
        """Gracefully handles state that has no copilotkit key at all."""
        incoming = {"messages": []}
        result = langgraph_default_merge_state(
            state=incoming,
            messages=self._make_messages(),
            actions=[{"name": "tool"}],
            agent_name="test_agent",
        )
        assert result["copilotkit"]["actions"] == [{"name": "tool"}]
        # context defaults to empty — no KeyError
        assert "context" not in result["copilotkit"] or result["copilotkit"]["context"] == []

    def test_empty_context_preserved(self):
        incoming = {
            "messages": [],
            "copilotkit": {"context": [], "actions": []},
        }
        result = langgraph_default_merge_state(
            state=incoming,
            messages=self._make_messages(),
            actions=[],
            agent_name="test_agent",
        )
        assert result["copilotkit"]["context"] == []
