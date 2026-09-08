"""Tests for CopilotKit/CopilotKit#3861: MESSAGES_SNAPSHOT must respect the same
`copilotkit:emit-messages` / `copilotkit:emit-tool-calls` metadata that
`_dispatch_event` already respects for the live stream.

`emit_messages=False` / `emit_tool_calls=False` (e.g. a subagent invoked from a tool
via a config built with `copilotkit_customize_config`) still reached the frontend
there even though the live stream already withheld it. Hidden IDs are recorded from
`on_chat_model_end` events at the moment the LLM call completes, persisted on
checkpoint messages, and loaded again by
`LangGraphAGUIAgent.get_state_and_messages_snapshots` on later requests.

Covers:
  1. `_dispatch_event` records suppressed message/tool-call ids onto `active_run`
  2. The recorded ids are used to filter MESSAGES_SNAPSHOT: hidden AIMessage
     content/tool_calls are stripped, orphaned ToolMessages are dropped, and an
     assistant turn left with neither content nor tool_calls is dropped entirely
  3. End-to-end: a real LangGraph checkpoint produced by a tool that delegates to
     an inner compiled graph — the delegation's tool_call and its ToolMessage
     result (which carries the inner agent's answer) are excluded from the
     snapshot, while the user's message and the orchestrator's own final visible
     answer are kept
  4. Request-boundary persistence: hidden markers survive across fresh agent
     instances and are not re-exposed on second requests via the same checkpoint
  5. Regression (#3861 Case A): emit_messages=False alone (without emit_tool_calls=False)
     must still hide the ToolMessage result of a hidden delegated execution
  6. Case A: visible outer tool call + hidden nested child output (Finding #2)
  7. Case B: outer tool call itself hidden + its result hidden (Finding #2)
  8. Case C: emit_tool_calls=False visibility in snapshot (Finding #2)
  9. Maintainer's false-positive regression: a node that makes a private LLM call
     with emit_messages=False and then returns a SEPARATE visible AIMessage must
     NOT have the visible AIMessage hidden from MESSAGES_SNAPSHOT
  10. copilotkit_customize_config must not mutate the caller's metadata dict
"""

import asyncio
from unittest.mock import MagicMock

import pytest
from ag_ui.core import (
    AssistantMessage,
    FunctionCall,
    MessagesSnapshotEvent,
    RunAgentInput,
    TextMessageContentEvent,
    ToolCall,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
    UserMessage,
)
from ag_ui.core import ToolMessage as AGUIToolMessage
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph

from copilotkit.langgraph import copilotkit_customize_config
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


@pytest.fixture
def agent():
    """A LangGraphAGUIAgent with a mocked graph and an active run, matching the
    fixture already used by test_agui_agent.py / test_emit_filtering.py."""
    mock_graph = MagicMock()
    mock_graph.get_state = MagicMock()
    a = LangGraphAGUIAgent(name="test", graph=mock_graph)
    a.active_run = {"id": "run-1", "thread_id": "t-1"}
    return a


# ---------- 0. copilotkit_customize_config must not mutate caller's metadata ----------


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
    copilotkit_customize_config(original_config, emit_messages=False)
    assert "metadata" not in original_config


# ---------- 1. _dispatch_event records suppressed ids ----------


class TestHiddenIdRecording:
    def test_suppressed_text_message_id_is_recorded(self, agent):
        event = TextMessageContentEvent(
            messageId="hidden-ai-1",
            delta="secret",
            rawEvent={"metadata": {"copilotkit:emit-messages": False}},
        )
        assert agent._dispatch_event(event) is None
        assert agent.active_run["copilotkit_hidden_message_ids"] == {"hidden-ai-1"}

    def test_suppressed_tool_call_id_is_recorded(self, agent):
        for event in (
            ToolCallStartEvent(
                toolCallId="hidden-tc-1",
                toolCallName="research",
                rawEvent={"metadata": {"copilotkit:emit-tool-calls": False}},
            ),
            ToolCallArgsEvent(
                toolCallId="hidden-tc-1",
                delta="{}",
                rawEvent={"metadata": {"copilotkit:emit-tool-calls": False}},
            ),
            ToolCallEndEvent(
                toolCallId="hidden-tc-1",
                rawEvent={"metadata": {"copilotkit:emit-tool-calls": False}},
            ),
        ):
            assert agent._dispatch_event(event) is None
        assert agent.active_run["copilotkit_hidden_tool_call_ids"] == {"hidden-tc-1"}

    def test_hidden_message_does_not_hide_visible_tool_result(self, agent):
        """A ToolMessage whose tool_call_id is NOT in hidden_tool_call_ids and
        whose own id is NOT in hidden_message_ids must pass through unchanged."""
        event = MessagesSnapshotEvent(
            messages=[
                AssistantMessage(
                    id="outer-ai-1",
                    content=None,
                    tool_calls=[
                        ToolCall(
                            id="visible-tc-1",
                            function=FunctionCall(name="research", arguments="{}"),
                        )
                    ],
                ),
                AGUIToolMessage(
                    id="result-1",
                    content="visible result",
                    tool_call_id="visible-tc-1",
                ),
            ]
        )
        agent.active_run["copilotkit_hidden_message_ids"] = {"inner-ai-1"}

        filtered = agent._filter_hidden_messages(event)

        assert [message.id for message in filtered.messages] == [
            "outer-ai-1",
            "result-1",
        ]

    def test_visible_events_are_not_recorded(self, agent):
        event = TextMessageContentEvent(
            messageId="visible-ai-1",
            delta="hello",
            rawEvent={"metadata": {"copilotkit:emit-messages": True}},
        )
        assert agent._dispatch_event(event) is not None
        assert "copilotkit_hidden_message_ids" not in agent.active_run

    def test_recording_is_a_noop_without_an_active_run(self):
        """object.__new__ bypasses __init__ (as test_intercepted_tool_call_events.py
        does), leaving active_run unset -- recording must not crash."""
        bare_agent = object.__new__(LangGraphAGUIAgent)
        bare_agent.active_run = None
        event = TextMessageContentEvent(
            messageId="hidden-ai-1",
            delta="secret",
            rawEvent={"metadata": {"copilotkit:emit-messages": False}},
        )
        assert bare_agent._dispatch_event(event) is None


# ---------- 2. _filter_hidden_messages ----------


class TestFilterHiddenMessages:
    def _snapshot(self, *messages):
        return MessagesSnapshotEvent(messages=list(messages))

    def test_no_hidden_ids_returns_event_unchanged(self, agent):
        event = self._snapshot()
        assert agent._filter_hidden_messages(event) is event

    def test_hidden_tool_call_stripped_and_orphan_tool_message_dropped(self, agent):
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-1"}

        event = self._snapshot(
            UserMessage(id="u1", content="hi"),
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-1",
                        function=FunctionCall(name="research", arguments="{}"),
                    ),
                    ToolCall(
                        id="tc-2",
                        function=FunctionCall(name="visible_tool", arguments="{}"),
                    ),
                ],
            ),
            AGUIToolMessage(id="tm-1", content="secret answer", tool_call_id="tc-1"),
            AGUIToolMessage(id="tm-2", content="visible answer", tool_call_id="tc-2"),
        )
        filtered = agent._filter_hidden_messages(event)
        ids = [m.id for m in filtered.messages]
        assert ids == ["u1", "ai-1", "tm-2"]
        remaining_tool_calls = filtered.messages[1].tool_calls
        assert [tc.id for tc in remaining_tool_calls] == ["tc-2"]

    def test_hidden_message_content_cleared(self, agent):
        agent.active_run["copilotkit_hidden_message_ids"] = {"ai-1"}

        event = self._snapshot(
            AssistantMessage(id="ai-1", content="secret", tool_calls=None)
        )
        filtered = agent._filter_hidden_messages(event)
        assert filtered.messages == []

    def test_empty_turn_dropped_entirely(self, agent):
        """An AssistantMessage whose only tool_call gets hidden and has no text
        content of its own is dropped rather than left as an empty bubble."""
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-1"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-1",
                        function=FunctionCall(name="research", arguments="{}"),
                    )
                ],
            )
        )
        filtered = agent._filter_hidden_messages(event)
        assert filtered.messages == []

    def test_untouched_message_is_not_copied(self, agent):
        """A message with nothing hidden about it must pass through unchanged
        (not a pointless model_copy), including one with naturally-empty content."""
        agent.active_run["copilotkit_hidden_message_ids"] = {"some-other-id"}

        original = UserMessage(id="u1", content="hi")
        event = self._snapshot(original)
        filtered = agent._filter_hidden_messages(event)
        assert filtered.messages[0] is original

    # ---- CASE A: visible outer tool call + hidden nested child output (Finding #2) ----

    def test_case_a_tool_message_hidden_by_message_id_not_tool_call_id(self, agent):
        """CASE A (Review Finding #2):
        Regression for the emit_messages=False-only bug.

        A ToolMessage whose own id is in hidden_message_ids (produced under
        emit_messages=False) must be dropped from the snapshot even when its
        tool_call_id is NOT in hidden_tool_call_ids.

        This covers the scenario: outer tool call visible, inner agent runs with
        emit_messages=False, the ToolMessage carries confidential content.
        """
        agent.active_run["copilotkit_hidden_message_ids"] = {"tm-hidden"}

        event = self._snapshot(
            UserMessage(id="u1", content="query"),
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-1",
                        function=FunctionCall(name="search", arguments="{}"),
                    )
                ],
            ),
            # ToolMessage's own id is hidden; its tool_call_id is NOT in hidden_tool_call_ids
            AGUIToolMessage(
                id="tm-hidden",
                content="CONFIDENTIAL secret result",
                tool_call_id="tc-1",
            ),
        )
        filtered = agent._filter_hidden_messages(event)
        ids = [m.id for m in filtered.messages]
        # ToolMessage must be dropped even though tc-1 is not in hidden_tool_call_ids
        assert "tm-hidden" not in ids
        assert not any("CONFIDENTIAL" in (m.content or "") for m in filtered.messages)

    def test_case_a_visible_tool_call_result_preserved_when_different_inner_hidden(
        self, agent
    ):
        """CASE A: Only the hidden result is dropped; other visible results survive."""
        agent.active_run["copilotkit_hidden_message_ids"] = {"tm-hidden"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-hidden-result",
                        function=FunctionCall(name="delegate", arguments="{}"),
                    ),
                    ToolCall(
                        id="tc-visible",
                        function=FunctionCall(name="search", arguments="{}"),
                    ),
                ],
            ),
            AGUIToolMessage(
                id="tm-hidden", content="CONFIDENTIAL", tool_call_id="tc-hidden-result"
            ),
            AGUIToolMessage(
                id="tm-visible", content="public result", tool_call_id="tc-visible"
            ),
        )
        filtered = agent._filter_hidden_messages(event)
        ids = [m.id for m in filtered.messages]
        assert "tm-hidden" not in ids
        assert "tm-visible" in ids
        assert not any("CONFIDENTIAL" in (m.content or "") for m in filtered.messages)
        # ai-1 still has both tool calls — only the result is hidden, not the call itself
        ai_msg = next(m for m in filtered.messages if m.id == "ai-1")
        assert len(ai_msg.tool_calls) == 2

    # ---- CASE B: outer tool call itself hidden + its result hidden (Finding #2) ----

    def test_case_b_outer_tool_call_hidden_with_result(self, agent):
        """CASE B (Review Finding #2):
        Outer tool call itself hidden (in hidden_tool_call_ids). Its result ToolMessage
        is also dropped. The entire assistant turn is dropped as it has no remaining content.
        """
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-hidden"}

        event = self._snapshot(
            UserMessage(id="u1", content="query"),
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-hidden",
                        function=FunctionCall(name="secret_tool", arguments="{}"),
                    )
                ],
            ),
            AGUIToolMessage(
                id="tm-1",
                content="confidential result",
                tool_call_id="tc-hidden",
            ),
            AssistantMessage(id="ai-2", content="Visible final answer"),
        )
        filtered = agent._filter_hidden_messages(event)
        ids = [m.id for m in filtered.messages]
        # ai-1 (whole turn hidden) and tm-1 (result of hidden tool call) both dropped
        assert ids == ["u1", "ai-2"]
        assert not any("confidential" in (m.content or "") for m in filtered.messages)

    def test_case_b_outer_tool_call_hidden_visible_sibling_kept(self, agent):
        """CASE B variant: When multiple tool calls exist in one turn, hiding one
        tool call must not affect its siblings."""
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-hidden"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-hidden",
                        function=FunctionCall(name="secret", arguments="{}"),
                    ),
                    ToolCall(
                        id="tc-visible",
                        function=FunctionCall(name="search", arguments="{}"),
                    ),
                ],
            ),
            AGUIToolMessage(id="tm-hidden", content="secret", tool_call_id="tc-hidden"),
            AGUIToolMessage(
                id="tm-visible", content="public result", tool_call_id="tc-visible"
            ),
        )
        filtered = agent._filter_hidden_messages(event)
        ids = [m.id for m in filtered.messages]
        assert ids == ["ai-1", "tm-visible"]
        remaining_tool_calls = filtered.messages[0].tool_calls
        assert [tc.id for tc in remaining_tool_calls] == ["tc-visible"]
        assert not any("secret" in (m.content or "") for m in filtered.messages)

    # ---- CASE C: emit_tool_calls=False visibility in snapshot (Finding #2) ----

    def test_case_c_emit_tool_calls_false_hides_tool_call_from_snapshot(self, agent):
        """CASE C: emit_tool_calls=False suppresses streaming tool events and the
        tool call must also not appear in the MESSAGES_SNAPSHOT."""
        # Simulate what _dispatch_event does when emit_tool_calls=False
        for event in (
            ToolCallStartEvent(
                toolCallId="tc-hidden-1",
                toolCallName="internal_search",
                rawEvent={"metadata": {"copilotkit:emit-tool-calls": False}},
            ),
            ToolCallArgsEvent(
                toolCallId="tc-hidden-1",
                delta='{"query":"confidential"}',
                rawEvent={"metadata": {"copilotkit:emit-tool-calls": False}},
            ),
            ToolCallEndEvent(
                toolCallId="tc-hidden-1",
                rawEvent={"metadata": {"copilotkit:emit-tool-calls": False}},
            ),
        ):
            agent._dispatch_event(event)

        assert agent.active_run["copilotkit_hidden_tool_call_ids"] == {"tc-hidden-1"}

        snapshot = MessagesSnapshotEvent(
            messages=[
                UserMessage(id="u1", content="query"),
                AssistantMessage(
                    id="ai-1",
                    content="",
                    tool_calls=[
                        ToolCall(
                            id="tc-hidden-1",
                            function=FunctionCall(
                                name="internal_search",
                                arguments='{"query":"confidential"}',
                            ),
                        )
                    ],
                ),
                AGUIToolMessage(
                    id="tm-1",
                    content="confidential search result",
                    tool_call_id="tc-hidden-1",
                ),
                AssistantMessage(id="ai-2", content="Here is the answer"),
            ]
        )
        filtered = agent._filter_hidden_messages(snapshot)
        ids = [m.id for m in filtered.messages]
        # ai-1 and tm-1 both dropped, u1 and ai-2 kept
        assert ids == ["u1", "ai-2"]
        assert not any(
            "confidential" in (m.content or "").lower() for m in filtered.messages
        )

    # ---- Additional edge cases ----

    def test_assistant_message_with_visible_text_and_hidden_tool_call(self, agent):
        """An assistant message with visible text AND a hidden tool call:
        the content is kept, only the hidden tool call is stripped."""
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-hidden"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content="I'll search for that.",
                tool_calls=[
                    ToolCall(
                        id="tc-hidden",
                        function=FunctionCall(name="secret_search", arguments="{}"),
                    )
                ],
            ),
        )
        filtered = agent._filter_hidden_messages(event)
        assert len(filtered.messages) == 1
        msg = filtered.messages[0]
        assert msg.content == "I'll search for that."
        assert not msg.tool_calls

    def test_multiple_sequential_tool_calls_mixed_visibility(self, agent):
        """Multiple tool calls in one turn: visible, hidden, visible. Only hidden is removed."""
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-2"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-1", function=FunctionCall(name="visible", arguments="{}")
                    ),
                    ToolCall(
                        id="tc-2", function=FunctionCall(name="hidden", arguments="{}")
                    ),
                    ToolCall(
                        id="tc-3",
                        function=FunctionCall(name="visible2", arguments="{}"),
                    ),
                ],
            ),
            AGUIToolMessage(id="tm-1", content="visible result 1", tool_call_id="tc-1"),
            AGUIToolMessage(id="tm-2", content="hidden result", tool_call_id="tc-2"),
            AGUIToolMessage(id="tm-3", content="visible result 3", tool_call_id="tc-3"),
        )
        filtered = agent._filter_hidden_messages(event)
        ids = [m.id for m in filtered.messages]
        assert "tm-2" not in ids
        assert ids == ["ai-1", "tm-1", "tm-3"]
        remaining_tcs = [tc.id for tc in filtered.messages[0].tool_calls]
        assert remaining_tcs == ["tc-1", "tc-3"]

    def test_no_leakage_of_hidden_text_content(self, agent):
        """Hidden message content must not appear in any form in the filtered snapshot."""
        agent.active_run["copilotkit_hidden_message_ids"] = {"ai-secret"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-secret",
                content="TOP SECRET: internal reasoning 42 widgets",
                tool_calls=None,
            ),
            AssistantMessage(id="ai-visible", content="Here is your answer."),
        )
        filtered = agent._filter_hidden_messages(event)
        for msg in filtered.messages:
            assert "SECRET" not in (msg.content or "")
            assert "42 widgets" not in (msg.content or "")
        ids = [m.id for m in filtered.messages]
        assert "ai-secret" not in ids
        assert "ai-visible" in ids

    def test_no_leakage_of_hidden_tool_call_id_or_arguments(self, agent):
        """Hidden tool call arguments must not appear in snapshot (tool call stripped)."""
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-secret"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-secret",
                        function=FunctionCall(
                            name="secret_tool",
                            arguments='{"api_key":"sk-secret123"}',
                        ),
                    )
                ],
            ),
        )
        filtered = agent._filter_hidden_messages(event)
        # ai-1 dropped entirely (no remaining content or tool calls)
        assert filtered.messages == []

    def test_orphaned_tool_message_dropped_when_parent_hidden(self, agent):
        """If the AIMessage that triggered a tool call is dropped entirely,
        its ToolMessage result must also be dropped (it would be an orphan)."""
        agent.active_run["copilotkit_hidden_tool_call_ids"] = {"tc-all"}

        event = self._snapshot(
            AssistantMessage(
                id="ai-1",
                content=None,
                tool_calls=[
                    ToolCall(
                        id="tc-all",
                        function=FunctionCall(name="search", arguments="{}"),
                    )
                ],
            ),
            AGUIToolMessage(id="tm-all", content="result", tool_call_id="tc-all"),
        )
        filtered = agent._filter_hidden_messages(event)
        assert filtered.messages == []


# ---------- 3. End-to-end: delegation via a tool wrapping an inner compiled graph ----------


def _build_inner_agent(*, hide_tool_calls):
    inner_chat_model = FakeListChatModel(
        responses=["CONFIDENTIAL internal reasoning: 42 widgets in stock."]
    )

    async def inner_agent_node(state, config):
        hidden_config = copilotkit_customize_config(
            config,
            emit_messages=False,
            emit_tool_calls=hide_tool_calls,
        )
        response = await inner_chat_model.ainvoke(
            state["messages"], config=hidden_config
        )
        return {
            "messages": [
                ToolMessage(
                    id="inner-tool-result",
                    content=response.content,
                    tool_call_id="tc-research-1",
                )
            ]
        }

    builder = StateGraph(MessagesState)
    builder.add_node("inner_agent", inner_agent_node)
    builder.add_edge(START, "inner_agent")
    builder.add_edge("inner_agent", END)
    return builder.compile()


def _build_outer_graph(inner_agent, *, thread_id="t1"):
    async def outer_agent_node(state, config):
        has_tool_result = any(isinstance(m, ToolMessage) for m in state["messages"])
        if not has_tool_result:
            return {
                "messages": [
                    AIMessage(
                        id="outer-ai-1",
                        content="",
                        tool_calls=[
                            {
                                "name": "research",
                                "id": "tc-research-1",
                                "args": {"query": "widgets"},
                            }
                        ],
                    )
                ]
            }
        return {
            "messages": [
                AIMessage(id="outer-ai-2", content="Here is your answer: 42 widgets.")
            ]
        }

    def route(state):
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "research"
        return END

    builder = StateGraph(MessagesState)
    builder.add_node("agent", outer_agent_node)
    builder.add_node("research", inner_agent)
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", route, {"research": "research", END: END})
    builder.add_edge("research", "agent")
    return builder.compile(checkpointer=InMemorySaver())


def test_hidden_delegation_persists_across_fresh_request():
    """Hidden outer tool output stays hidden on a fresh request for the thread.

    Primary regression for issue #3861 request-boundary persistence.
    Uses emit_messages=False AND emit_tool_calls=False on the inner subagent.
    Both first and second (fresh agent) snapshots must exclude hidden content.
    """
    inner_agent = _build_inner_agent(hide_tool_calls=False)
    outer_graph = _build_outer_graph(inner_agent)
    config = {"configurable": {"thread_id": "t1"}}

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        run_input = RunAgentInput(
            threadId="t1",
            runId="run-1",
            state={},
            messages=[
                {
                    "id": "u1",
                    "role": "user",
                    "content": "how many widgets do we have?",
                }
            ],
            tools=[],
            context=[],
            forwardedProps={},
        )

        first_events = [e async for e in agent.run(run_input)]
        raw_events = [
            event.event for event in first_events if event.type.value == "RAW"
        ]
        assert any(
            event.get("event") == "on_chat_model_stream"
            and event.get("metadata", {}).get("copilotkit:emit-messages") is False
            for event in raw_events
            if isinstance(event, dict)
        )
        first_snapshot = next(
            event
            for event in reversed(first_events)
            if isinstance(event, MessagesSnapshotEvent)
        )

        state = await outer_graph.aget_state(config)
        checkpoint_messages = state.values["messages"]
        assert any(
            isinstance(message, ToolMessage) and "CONFIDENTIAL" in message.content
            for message in checkpoint_messages
        )
        persisted_state = await outer_graph.aget_state(config)
        persisted_tool_message = next(
            message
            for message in persisted_state.values["messages"]
            if isinstance(message, ToolMessage)
        )
        assert (
            persisted_tool_message.additional_kwargs["copilotkit_visibility"][
                "hidden_message"
            ]
            is True
        ), (
            "ToolMessage from hidden inner agent must have hidden_message=True marker. "
            f"Got: {persisted_tool_message.additional_kwargs}"
        )

        fresh_agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        second_events = [e async for e in fresh_agent.run(run_input)]
        second_snapshot = next(
            event
            for event in reversed(second_events)
            if isinstance(event, MessagesSnapshotEvent)
        )
        return first_snapshot, second_snapshot

    first_snapshot, second_snapshot = asyncio.run(_run())

    for snapshot in (first_snapshot, second_snapshot):
        ids = [message.id for message in snapshot.messages]
        assert ids == ["u1", "outer-ai-1", "outer-ai-2"]
        assert not any(
            "CONFIDENTIAL" in (message.content or "") for message in snapshot.messages
        )
        assert snapshot.messages[-1].content == "Here is your answer: 42 widgets."


def test_emit_messages_false_alone_hides_tool_message_result():
    """Regression for the emit_messages=False-only bug (Finding #2 / Case A).

    When the inner node runs with emit_messages=False (but emit_tool_calls is NOT
    suppressed), the ToolMessage it returns carries confidential content. The
    ToolMessage's own id IS in hidden_message_ids because the node ran under
    emit_messages=False. The ToolMessage must be dropped from MESSAGES_SNAPSHOT
    even though its tool_call_id is NOT in hidden_tool_call_ids.

    This test fails against the old implementation and passes with the fix.
    """
    inner_chat_model = FakeListChatModel(
        responses=["CONFIDENTIAL: secret internal reasoning"]
    )

    async def inner_agent_node(state, config):
        # Only emit_messages=False — emit_tool_calls is NOT suppressed
        hidden_config = copilotkit_customize_config(config, emit_messages=False)
        response = await inner_chat_model.ainvoke(
            state["messages"], config=hidden_config
        )
        return {
            "messages": [
                ToolMessage(
                    id="inner-tool-result",
                    content=response.content,
                    tool_call_id="tc-research-1",
                )
            ]
        }

    builder = StateGraph(MessagesState)
    builder.add_node("inner_agent", inner_agent_node)
    builder.add_edge(START, "inner_agent")
    builder.add_edge("inner_agent", END)
    inner_agent = builder.compile()

    outer_graph = _build_outer_graph(inner_agent, thread_id="t2")

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        run_input = RunAgentInput(
            threadId="t2",
            runId="run-1",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "query"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        first_events = [e async for e in agent.run(run_input)]
        first_snapshot = next(
            e for e in reversed(first_events) if isinstance(e, MessagesSnapshotEvent)
        )

        # Second request with fresh agent — hidden content must not reappear
        fresh_agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        second_events = [e async for e in fresh_agent.run(run_input)]
        second_snapshot = next(
            e for e in reversed(second_events) if isinstance(e, MessagesSnapshotEvent)
        )
        return first_snapshot, second_snapshot

    first_snapshot, second_snapshot = asyncio.run(_run())

    for snapshot in (first_snapshot, second_snapshot):
        # CONFIDENTIAL content must not appear in either snapshot
        assert not any(
            "CONFIDENTIAL" in (m.content or "") for m in snapshot.messages
        ), (
            f"Hidden content leaked into snapshot: {[m.content for m in snapshot.messages]}"
        )
        # The ToolMessage inner-tool-result must be absent from the snapshot
        assert "inner-tool-result" not in [m.id for m in snapshot.messages]


# ---------- 4. Maintainer's false-positive regression (CRITICAL) ----------


def test_visible_message_from_same_node_not_hidden():
    """Maintainer's false-positive regression: a node that makes a private LLM call
    with emit_messages=False and then returns a SEPARATE visible AIMessage must NOT
    have the visible AIMessage hidden from MESSAGES_SNAPSHOT.

    The previous namespace-inheritance approach failed this case because it marked
    the entire node namespace as hidden when any event in it had emit_messages=False.
    The correct on_chat_model_end approach records only the specific AIMessage
    produced by the hidden LLM call, not the node's return value.

    Expected snapshot: ['u1', 'visible-reply']
    Previous (wrong) snapshot: ['u1']
    """
    private_model = FakeListChatModel(
        responses=["INTERNAL: secret chain-of-thought reasoning."]
    )

    async def smart_node(state, config):
        # Step 1: make a private LLM call (hidden from stream and snapshot)
        modified_config = copilotkit_customize_config(config, emit_messages=False)
        await private_model.ainvoke(state["messages"], config=modified_config)

        # Step 2: return a SEPARATE visible AIMessage — this must appear in snapshot
        # (It is a node return value, not an LLM output, so it has no
        # on_chat_model_end event and must never be marked hidden.)
        return {
            "messages": [AIMessage(id="visible-reply", content="Your answer is 42.")]
        }

    builder = StateGraph(MessagesState)
    builder.add_node("smart_node", smart_node)
    builder.add_edge(START, "smart_node")
    builder.add_edge("smart_node", END)
    graph = builder.compile(checkpointer=InMemorySaver())

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=graph)
        run_input = RunAgentInput(
            threadId="t-fp",
            runId="run-1",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "What is the answer?"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        events = [e async for e in agent.run(run_input)]
        snapshot = next(
            e for e in reversed(events) if isinstance(e, MessagesSnapshotEvent)
        )
        return snapshot

    snapshot = asyncio.run(_run())
    ids = [m.id for m in snapshot.messages]

    # The visible-reply MUST be in the snapshot
    assert "visible-reply" in ids, (
        f"visible-reply was incorrectly hidden from snapshot. Got ids: {ids}"
    )
    # The user message must also be present
    assert "u1" in ids
    # No internal/secret content must leak
    assert not any("INTERNAL" in (m.content or "") for m in snapshot.messages)
    # The visible answer must be intact
    visible = next(m for m in snapshot.messages if m.id == "visible-reply")
    assert visible.content == "Your answer is 42."


def test_hidden_markers_persisted_on_checkpoint_messages():
    """Verify that hidden markers are correctly written to checkpoint messages so
    a fresh agent instance on a second request can reconstruct hidden_message_ids
    and hidden_tool_call_ids without relying on in-memory active_run state.

    Covers matrix items 14-15 (second request, fresh agent reads persisted history).
    """
    inner_agent = _build_inner_agent(hide_tool_calls=False)
    outer_graph = _build_outer_graph(inner_agent, thread_id="t3")
    config = {"configurable": {"thread_id": "t3"}}

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        run_input = RunAgentInput(
            threadId="t3",
            runId="run-1",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "query"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        [e async for e in agent.run(run_input)]

        state = await outer_graph.aget_state(config)
        return state.values["messages"]

    checkpoint_messages = asyncio.run(_run())

    # The ToolMessage must have the hidden_message marker because the inner node
    # ran with emit_messages=False — the ToolMessage ID is recorded via
    # _record_hidden_output_ids (on_chain_end for the inner_agent namespace)
    tool_messages = [m for m in checkpoint_messages if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 1
    tm = tool_messages[0]
    visibility = tm.additional_kwargs.get("copilotkit_visibility", {})
    # hidden_message must be True — the ToolMessage is in hidden_message_ids
    assert visibility.get("hidden_message") is True, (
        f"Expected hidden_message=True in ToolMessage visibility markers. "
        f"Got: {visibility}"
    )


def test_visible_normal_conversation_passes_through_unchanged():
    """Matrix item 1: Normal visible user + assistant messages pass through
    the filter completely unchanged. No filtering artifacts.
    """

    async def visible_agent(state, config):
        if len(state["messages"]) == 1:
            return {"messages": [AIMessage(id="ai-1", content="Hello there!")]}
        return {}

    builder = StateGraph(MessagesState)
    builder.add_node("agent", visible_agent)
    builder.add_edge(START, "agent")
    builder.add_edge("agent", END)
    outer_graph = builder.compile(checkpointer=InMemorySaver())

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        run_input = RunAgentInput(
            threadId="t4",
            runId="run-1",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "hello"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        events = [e async for e in agent.run(run_input)]
        snapshot = next(
            e for e in reversed(events) if isinstance(e, MessagesSnapshotEvent)
        )
        return snapshot

    snapshot = asyncio.run(_run())
    ids = [m.id for m in snapshot.messages]
    assert "u1" in ids
    assert "ai-1" in ids
    assert snapshot.messages[-1].content == "Hello there!"


def test_second_request_same_thread_no_new_delegation():
    """Matrix items 13-15: On a second request that adds no new hidden delegation,
    the previously hidden content still does not appear in the snapshot.

    Tests the full request-boundary persistence path end-to-end:
    1. First request creates hidden content and persists markers to checkpoint
    2. Second request on same thread reads those markers and filters the snapshot
    """
    inner_agent = _build_inner_agent(hide_tool_calls=False)
    outer_graph = _build_outer_graph(inner_agent, thread_id="t5")

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        run_input_1 = RunAgentInput(
            threadId="t5",
            runId="run-1",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "how many widgets?"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        [e async for e in agent.run(run_input_1)]

        # Second request: new agent instance, same thread, same checkpoint
        fresh_agent = LangGraphAGUIAgent(name="test", graph=outer_graph)
        run_input_2 = RunAgentInput(
            threadId="t5",
            runId="run-2",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "how many widgets?"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        events = [e async for e in fresh_agent.run(run_input_2)]
        snapshot = next(
            e for e in reversed(events) if isinstance(e, MessagesSnapshotEvent)
        )
        return snapshot

    snapshot = asyncio.run(_run())
    assert not any("CONFIDENTIAL" in (m.content or "") for m in snapshot.messages)
    assert "inner-tool-result" not in [m.id for m in snapshot.messages]


def test_sibling_messages_in_same_node_with_different_visibility():
    """Requirement 7: Test that multiple calls in the same node can have different visibility.
    hidden LLM call 1 (A)
    visible message (B)
    hidden LLM call 2 (C)
    Expected: only A and C are filtered; B remains in MESSAGES_SNAPSHOT.
    """
    private_model = FakeListChatModel(
        responses=[
            "CONFIDENTIAL: private query 1 result",
            "CONFIDENTIAL: private query 2 result",
        ]
    )

    async def multi_call_node(state, config):
        # Step 1: private LLM call 1 (hidden)
        hidden_cfg1 = copilotkit_customize_config(config, emit_messages=False)
        await private_model.ainvoke(state["messages"], config=hidden_cfg1)

        # Step 2: private LLM call 2 (hidden)
        hidden_cfg2 = copilotkit_customize_config(config, emit_messages=False)
        await private_model.ainvoke(state["messages"], config=hidden_cfg2)

        # Step 3: visible AIMessage returned by node
        return {
            "messages": [
                AIMessage(id="visible-summary", content="Visible summary of findings.")
            ]
        }

    builder = StateGraph(MessagesState)
    builder.add_node("multi_call", multi_call_node)
    builder.add_edge(START, "multi_call")
    builder.add_edge("multi_call", END)
    graph = builder.compile(checkpointer=InMemorySaver())

    async def _run():
        agent = LangGraphAGUIAgent(name="test", graph=graph)
        run_input = RunAgentInput(
            threadId="t-sibling",
            runId="run-1",
            state={},
            messages=[{"id": "u1", "role": "user", "content": "analyze data"}],
            tools=[],
            context=[],
            forwardedProps={},
        )
        events = [e async for e in agent.run(run_input)]
        snapshot = next(
            e for e in reversed(events) if isinstance(e, MessagesSnapshotEvent)
        )
        return snapshot

    snapshot = asyncio.run(_run())
    ids = [m.id for m in snapshot.messages]

    assert "u1" in ids
    assert "visible-summary" in ids
    assert not any("CONFIDENTIAL" in (m.content or "") for m in snapshot.messages)
    summary_msg = next(m for m in snapshot.messages if m.id == "visible-summary")
    assert summary_msg.content == "Visible summary of findings."
