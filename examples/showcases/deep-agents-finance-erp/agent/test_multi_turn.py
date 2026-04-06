"""Standalone multi-turn test — tests both raw LangGraph and ag_ui_langgraph integration.

Run from the agent directory:
    cd examples/showcases/deep-agents-finance-erp/agent
    python test_multi_turn.py
"""

import asyncio
import json
import os
import uuid

from dotenv import load_dotenv

load_dotenv()

from langchain_core.messages import HumanMessage

from agent import build_agent


async def test_raw_langgraph():
    """Test multi-turn directly with LangGraph (bypasses ag_ui_langgraph)."""
    print("=" * 60)
    print("TEST 1: Raw LangGraph multi-turn")
    print("=" * 60)

    graph = build_agent()
    config = {"configurable": {"thread_id": "test-raw-001"}}

    # Turn 1
    event_count_1 = 0
    async for event in graph.astream_events(
        {"messages": [HumanMessage(content="What is 2+2?")]},
        config=config,
        version="v2",
    ):
        event_count_1 += 1
    state1 = await graph.aget_state(config)
    print(f"Turn 1: {event_count_1} events, {len(state1.values.get('messages', []))} messages, next={state1.next}")

    # Turn 2
    event_count_2 = 0
    async for event in graph.astream_events(
        {"messages": [HumanMessage(content="And what is 3+3?")]},
        config=config,
        version="v2",
    ):
        event_count_2 += 1
    state2 = await graph.aget_state(config)
    print(f"Turn 2: {event_count_2} events, {len(state2.values.get('messages', []))} messages, next={state2.next}")
    print(f"RESULT: {'PASS' if event_count_2 > 0 else 'FAIL'}")
    print()
    return event_count_2 > 0


async def test_agui_integration():
    """Test multi-turn through LangGraphAGUIAgent (mimics CopilotKit flow)."""
    print("=" * 60)
    print("TEST 2: ag_ui_langgraph integration multi-turn")
    print("=" * 60)

    from ag_ui.core.types import RunAgentInput, UserMessage, AssistantMessage, ToolMessage as AGUIToolMessage
    from copilotkit import LangGraphAGUIAgent
    from copilotkit.langgraph import copilotkit_customize_config
    from frontend_tools import ui_tools, hitl_tools
    from isolated_subagents import do_research, do_projections

    agent_graph = build_agent()
    _emit_tool_names = (
        [t.name for t in ui_tools]
        + [t.name for t in hitl_tools]
        + [do_research.name, do_projections.name]
    )
    agui_config = copilotkit_customize_config(
        emit_tool_calls=_emit_tool_names,
        emit_messages=True,
    )
    agui_config["recursion_limit"] = 100

    agui_agent = LangGraphAGUIAgent(
        name="finance_erp_agent",
        description="Test agent",
        graph=agent_graph,
        config=agui_config,
    )

    thread_id = f"test-agui-{uuid.uuid4().hex[:8]}"

    # --- Turn 1 ---
    msg1_id = str(uuid.uuid4())
    input1 = RunAgentInput(
        thread_id=thread_id,
        run_id=str(uuid.uuid4()),
        messages=[
            UserMessage(id=msg1_id, role="user", content="What is 2+2?"),
        ],
        tools=[],
        context=[],
        forwarded_props={},
        state={},
    )

    events_1 = []
    async for event_str in agui_agent.run(input1):
        events_1.append(event_str)

    print(f"Turn 1: {len(events_1)} SSE events emitted")

    # Extract messages from the last MessagesSnapshot or StateSnapshot
    # to send them back in turn 2 (mimicking frontend behavior)
    turn1_messages = []
    for evt_str in events_1:
        if isinstance(evt_str, str) and "MESSAGES_SNAPSHOT" in evt_str:
            try:
                # Parse SSE data
                for line in evt_str.split("\n"):
                    if line.startswith("data:"):
                        data = json.loads(line[5:].strip())
                        if data.get("type") == "MESSAGES_SNAPSHOT":
                            turn1_messages = data.get("messages", [])
            except (json.JSONDecodeError, KeyError):
                pass

    if not turn1_messages:
        # Try parsing events as raw dicts
        for evt in events_1:
            if hasattr(evt, 'type') and str(evt.type) == "EventType.MESSAGES_SNAPSHOT":
                turn1_messages = evt.messages if hasattr(evt, 'messages') else []

    print(f"Turn 1 messages captured: {len(turn1_messages)}")

    if not turn1_messages:
        print("WARNING: Could not capture messages from turn 1. Constructing manually...")
        # Get state directly from the graph
        config = {"configurable": {"thread_id": thread_id}}
        state = await agent_graph.aget_state(config)
        checkpoint_msgs = state.values.get("messages", [])
        print(f"  Checkpoint has {len(checkpoint_msgs)} messages")

        # Construct AG-UI messages from checkpoint
        turn1_messages = []
        for msg in checkpoint_msgs:
            role = "human" if msg.type == "human" else ("assistant" if msg.type == "ai" else "tool")
            turn1_messages.append({
                "id": msg.id,
                "role": role,
                "content": msg.content if isinstance(msg.content, str) else str(msg.content),
            })

    # --- Turn 2 ---
    msg2_id = str(uuid.uuid4())
    all_messages = []
    for m in turn1_messages:
        if isinstance(m, dict):
            role_str = m.get("role", "human")
            if role_str in ("human", "user"):
                all_messages.append(UserMessage(id=m["id"], role="user", content=m.get("content", "")))
            elif role_str == "assistant":
                all_messages.append(AssistantMessage(id=m["id"], role="assistant", content=m.get("content", "")))
            elif role_str == "tool":
                all_messages.append(AGUIToolMessage(id=m["id"], role="tool", content=m.get("content", ""), tool_call_id=m.get("tool_call_id", "")))
        else:
            all_messages.append(m)
    all_messages.append(UserMessage(id=msg2_id, role="user", content="And what is 3+3?"))

    input2 = RunAgentInput(
        thread_id=thread_id,
        run_id=str(uuid.uuid4()),
        messages=all_messages,
        tools=[],
        context=[],
        forwarded_props={},
        state={},
    )

    print(f"\nTurn 2: Sending {len(all_messages)} messages...")
    events_2 = []
    try:
        async for event_str in agui_agent.run(input2):
            events_2.append(event_str)
    except Exception as e:
        print(f"Turn 2 ERROR: {type(e).__name__}: {e}")

    # Count event types
    event_types = {}
    for evt in events_2:
        if isinstance(evt, str):
            for line in evt.split("\n"):
                if line.startswith("data:"):
                    try:
                        data = json.loads(line[5:].strip())
                        t = data.get("type", "unknown")
                        event_types[t] = event_types.get(t, 0) + 1
                    except json.JSONDecodeError:
                        pass

    print(f"Turn 2: {len(events_2)} SSE events emitted")
    print(f"Turn 2 event types: {event_types}")

    has_text = any("TEXT_MESSAGE" in str(e) for e in events_2)
    has_tool = any("TOOL_CALL" in str(e) for e in events_2)
    print(f"Turn 2 has text messages: {has_text}")
    print(f"Turn 2 has tool calls: {has_tool}")

    if has_text or has_tool:
        print("RESULT: PASS")
    elif len(events_2) > 0:
        print("RESULT: PARTIAL — events emitted but no text/tool content")
        print("  This means ag_ui_langgraph is running but the graph produces no new content")
    else:
        print("RESULT: FAIL — no events emitted")
    print()
    return has_text or has_tool


async def main():
    raw_pass = await test_raw_langgraph()
    agui_pass = await test_agui_integration()

    print("=" * 60)
    print(f"Raw LangGraph:   {'PASS' if raw_pass else 'FAIL'}")
    print(f"AGUI Integration: {'PASS' if agui_pass else 'FAIL'}")
    if raw_pass and not agui_pass:
        print("\nDiagnosis: Bug is in ag_ui_langgraph / CopilotKit integration layer")
    elif not raw_pass:
        print("\nDiagnosis: Bug is in LangGraph graph construction")
    else:
        print("\nBoth pass — issue may be in HTTP transport or frontend")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
