"""
Behavior tests for thread management scenarios.

Uses real LangGraph checkpointer to detect actual bugs.
Minimal mocking - only the graph workflow itself.
"""

import pytest
import uuid
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage, AIMessage
from typing import TypedDict, Annotated
from operator import add


class State(TypedDict):
    """Simple state for testing"""
    messages: Annotated[list, add]


@pytest.fixture
def test_graph():
    """Real LangGraph graph with real checkpointer"""
    def process_node(state: State):
        """Simulate agent processing"""
        if state.get("messages"):
            last_msg = state["messages"][-1]
            if isinstance(last_msg, HumanMessage):
                return {"messages": [AIMessage(content=f"Response: {last_msg.content}")]}
        return {"messages": []}

    workflow = StateGraph(State)
    workflow.add_node("process", process_node)
    workflow.add_edge(START, "process")
    workflow.add_edge("process", END)

    # Real checkpointer - this is what exposes the caching bug
    checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)


@pytest.fixture
def agent(test_graph):
    """Real LangGraphAgent with real graph"""
    from copilotkit import LangGraphAgent
    return LangGraphAgent(name="test_agent", graph=test_graph, langgraph_config={})


async def send_message(agent, graph, thread_id: str, message: str):
    """Send message through real agent and graph"""
    # Invoke graph to add message (simulates generateCopilotResponse)
    await graph.ainvoke(
        {"messages": [HumanMessage(content=message)]},
        config={"configurable": {"thread_id": thread_id}}
    )
    # Get state through agent (uses agent.get_state which may cache)
    return await agent.get_state(thread_id=thread_id)


async def load_thread(agent, thread_id: str):
    """Load thread state through agent"""
    return await agent.get_state(thread_id=thread_id)


class TestThreadBehaviors:
    """Test user-facing thread behaviors with real components"""

    @pytest.mark.asyncio
    async def test_new_thread_creation(self, agent, test_graph):
        """Creating new thread with UUID works"""
        thread_id = str(uuid.uuid4())

        # New thread doesn't exist
        state = await load_thread(agent, thread_id)
        assert state["threadExists"] == False, "New thread should not exist"
        assert state["messages"] == [], "New thread should have no messages"

        # Send first message through real graph
        state = await send_message(agent, test_graph, thread_id, "Hello")
        assert state["threadExists"] == True, (
            "Thread MUST exist after first message. "
            "If this fails, agent is not detecting persisted state."
        )
        assert len(state["messages"]) >= 1, "Should have at least user message"

        # Verify content
        user_msgs = [m for m in state["messages"] if m["role"] == "user"]
        assert len(user_msgs) >= 1, "Should have user message"
        assert "Hello" in user_msgs[0]["content"]

    @pytest.mark.asyncio
    async def test_returning_to_thread_shows_new_messages(self, agent, test_graph):
        """Returning to thread shows messages added (detects caching bug)"""
        thread_id = str(uuid.uuid4())

        # Send first message
        await send_message(agent, test_graph, thread_id, "Message 1")

        # Load thread state
        state1 = await load_thread(agent, thread_id)
        count1 = len([m for m in state1["messages"] if m["role"] == "user"])

        # Send second message through graph (adds to checkpointer)
        await send_message(agent, test_graph, thread_id, "Message 2")

        # Load thread again - MUST see new message
        state2 = await load_thread(agent, thread_id)
        user_msgs = [m for m in state2["messages"] if m["role"] == "user"]

        assert len(user_msgs) > count1, (
            f"BEHAVIOR: Returning to a thread must show all current messages, not cached old state.\n"
            f"Sent 2 messages to thread, but get_state returned only {len(user_msgs)} message(s). "
            f"Agent must fetch fresh state from checkpointer each time."
        )

        # Verify actual content
        assert len(user_msgs) >= 2, (
            f"BEHAVIOR: Returning to a thread must show all current messages.\n"
            f"Sent 2 messages ['Message 1', 'Message 2'], but get_state returned {len(user_msgs)} message(s)"
        )
        assert "Message 1" in user_msgs[0]["content"], (
            f"BEHAVIOR: Thread messages must persist with correct content.\n"
            f"First message should be 'Message 1', got: {user_msgs[0]['content']}"
        )
        assert "Message 2" in user_msgs[1]["content"], (
            f"BEHAVIOR: New messages must be visible when returning to thread.\n"
            f"Second message should be 'Message 2', got: {user_msgs[1]['content'] if len(user_msgs) > 1 else 'missing'}"
        )

    @pytest.mark.asyncio
    async def test_thread_history_persists(self, agent, test_graph):
        """Thread history shows all messages"""
        thread_id = str(uuid.uuid4())

        # Send 3 messages
        await send_message(agent, test_graph, thread_id, "First")
        await send_message(agent, test_graph, thread_id, "Second")
        await send_message(agent, test_graph, thread_id, "Third")

        # Load final state
        state = await load_thread(agent, thread_id)
        user_msgs = [m for m in state["messages"] if m["role"] == "user"]

        assert len(user_msgs) >= 3, (
            f"BEHAVIOR: Thread history must persist - all messages should be retrievable.\n"
            f"Sent 3 messages ['First', 'Second', 'Third'] to thread, "
            f"but get_state returned only {len(user_msgs)} message(s): "
            f"{[m['content'] for m in user_msgs]}"
        )
        assert "First" in user_msgs[0]["content"], (
            f"BEHAVIOR: Thread history must preserve message order and content.\n"
            f"First message should contain 'First', got: {user_msgs[0]['content']}"
        )
        assert "Second" in user_msgs[1]["content"], (
            f"BEHAVIOR: Thread history must preserve all messages in order.\n"
            f"Second message should contain 'Second', got: {user_msgs[1]['content']}"
        )
        assert "Third" in user_msgs[2]["content"], (
            f"BEHAVIOR: Thread history must preserve all messages in order.\n"
            f"Third message should contain 'Third', got: {user_msgs[2]['content']}"
        )

    @pytest.mark.asyncio
    async def test_switching_between_threads(self, agent, test_graph):
        """Switching threads shows correct messages"""
        thread_a = str(uuid.uuid4())
        thread_b = str(uuid.uuid4())

        # Thread A
        await send_message(agent, test_graph, thread_a, "A message 1")
        await send_message(agent, test_graph, thread_a, "A message 2")

        # Thread B
        await send_message(agent, test_graph, thread_b, "B message 1")

        # Switch back to A - must see A's messages, not B's
        state_a = await load_thread(agent, thread_a)
        user_msgs_a = [m for m in state_a["messages"] if m["role"] == "user"]
        assert len(user_msgs_a) >= 2, (
            f"BEHAVIOR: Switching between threads must preserve per-thread message history.\n"
            f"Thread A: sent 2 messages ['A message 1', 'A message 2'], "
            f"but get_state returned {len(user_msgs_a)} message(s): "
            f"{[m['content'] for m in user_msgs_a]}"
        )
        assert "A message 1" in user_msgs_a[0]["content"], (
            f"BEHAVIOR: Thread A messages must remain isolated from Thread B.\n"
            f"Thread A first message should be 'A message 1', got: {user_msgs_a[0]['content']}"
        )
        assert "A message 2" in user_msgs_a[1]["content"], (
            f"BEHAVIOR: Switching threads must not lose messages.\n"
            f"Thread A second message should be 'A message 2', got: {user_msgs_a[1]['content']}"
        )

        # Load B - must see B's messages, not A's
        state_b = await load_thread(agent, thread_b)
        user_msgs_b = [m for m in state_b["messages"] if m["role"] == "user"]
        assert len(user_msgs_b) >= 1, (
            f"BEHAVIOR: Each thread must maintain separate message history.\n"
            f"Thread B: sent 1 message ['B message 1'], "
            f"but get_state returned {len(user_msgs_b)} message(s)"
        )
        assert "B message 1" in user_msgs_b[0]["content"], (
            f"BEHAVIOR: Threads must remain isolated - Thread B should not show Thread A messages.\n"
            f"Thread B message should be 'B message 1', got: {user_msgs_b[0]['content']}"
        )

    @pytest.mark.asyncio
    async def test_rapid_thread_switching(self, agent, test_graph):
        """Rapidly switching shows correct content"""
        threads = {str(uuid.uuid4()): f"Thread {i}" for i in range(3)}

        # Create threads
        for tid, msg in threads.items():
            await send_message(agent, test_graph, tid, msg)

        # Rapidly switch and verify
        for _ in range(3):
            for tid, expected_msg in threads.items():
                state = await load_thread(agent, tid)
                user_msgs = [m for m in state["messages"] if m["role"] == "user"]
                assert len(user_msgs) >= 1
                assert expected_msg in user_msgs[0]["content"], (
                    f"BEHAVIOR: Rapid thread switching must maintain correct per-thread state.\n"
                    f"Expected thread to contain '{expected_msg}', got: {user_msgs[0]['content']}"
                )

    @pytest.mark.asyncio
    async def test_thread_isolation(self, agent, test_graph):
        """Threads remain completely isolated"""
        thread1 = str(uuid.uuid4())
        thread2 = str(uuid.uuid4())

        await send_message(agent, test_graph, thread1, "Thread 1 content")
        await send_message(agent, test_graph, thread2, "Thread 2 content")

        state1 = await load_thread(agent, thread1)
        state2 = await load_thread(agent, thread2)

        msg1 = next(m for m in state1["messages"] if m["role"] == "user")
        msg2 = next(m for m in state2["messages"] if m["role"] == "user")

        assert "Thread 1" in msg1["content"], (
            f"BEHAVIOR: Threads must remain completely isolated.\n"
            f"Thread 1 should contain 'Thread 1 content', got: {msg1['content']}"
        )
        assert "Thread 2" in msg2["content"], (
            f"BEHAVIOR: Threads must remain completely isolated.\n"
            f"Thread 2 should contain 'Thread 2 content', got: {msg2['content']}"
        )
        assert msg1["content"] != msg2["content"], (
            f"BEHAVIOR: Different threads must have different message content.\n"
            f"Thread 1 and Thread 2 both showing: {msg1['content']}"
        )

    @pytest.mark.asyncio
    async def test_empty_thread_handling(self, agent, test_graph):
        """Empty thread IDs handled gracefully"""
        state = await load_thread(agent, "")
        assert state["threadExists"] == False
        assert state["messages"] == []
        assert state["state"] == {}

    @pytest.mark.asyncio
    async def test_messages_accumulate_not_replace(self, agent, test_graph):
        """Each message adds to history"""
        thread_id = str(uuid.uuid4())

        await send_message(agent, test_graph, thread_id, "Msg 1")
        await send_message(agent, test_graph, thread_id, "Msg 2")
        state = await load_thread(agent, thread_id)

        user_msgs = [m for m in state["messages"] if m["role"] == "user"]
        assert len(user_msgs) >= 2, (
            f"BEHAVIOR: Messages must accumulate in history, not replace previous messages.\n"
            f"Sent 2 messages ['Msg 1', 'Msg 2'] to thread, "
            f"but get_state returned {len(user_msgs)} message(s): "
            f"{[m['content'] for m in user_msgs]}"
        )
        assert "Msg 1" in user_msgs[0]["content"], (
            f"BEHAVIOR: Previous messages must remain in history when new messages are added.\n"
            f"First message should be 'Msg 1', got: {user_msgs[0]['content']}"
        )
        assert "Msg 2" in user_msgs[1]["content"], (
            f"BEHAVIOR: New messages must be added to history, not replace existing ones.\n"
            f"Second message should be 'Msg 2', got: {user_msgs[1]['content'] if len(user_msgs) > 1 else 'missing'}"
        )
