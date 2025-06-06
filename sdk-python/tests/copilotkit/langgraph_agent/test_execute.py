import pytest
from .agent import human_in_the_loop_graph, INTERRUPTED_NODE_NAME
from copilotkit.langgraph import langchain_messages_to_copilotkit
from copilotkit.langgraph_agent import LangGraphAgent
from copilotkit.types import MetaEvent
import json

LANGGRAPH_CONFIG = {
    "thread_id": "thread_123",
    "run_id": "456",
    "configurable": {
        "thread_id": "thread_123",
        "run_id": "456",
    }
}

HUMAN_FEEDBACK_AFTER_INTERRUPT = "Here is my feedback"

@pytest.mark.asyncio
async def test_execute():
    agent = LangGraphAgent(
        name="human_in_the_loop_agent",
        graph=human_in_the_loop_graph,
        langgraph_config=LANGGRAPH_CONFIG
    )
    await agent.graph.ainvoke(
        {
            "input": "Hello, how are you?",
        },
        {
            "configurable": LANGGRAPH_CONFIG
        }
    )
    current_state = await agent.graph.aget_state(config=LANGGRAPH_CONFIG)
    current_task = current_state.tasks[0]
    assert current_task.interrupts is not None
    assert current_task.interrupts[0].value.get("tell") == "me what you think"

    # Now send a meta event with the user response
    meta_event = MetaEvent(
        name="LangGraphInterruptEvent",
        response="Here is my feedback"
    )

    # Generate the results
    events = []
    async for event in agent.execute(
        state={"messages": langchain_messages_to_copilotkit(current_state.values.get("messages", []))},
        config=LANGGRAPH_CONFIG,
        messages=[{"type": "TextMessage", "role": "user", "content": HUMAN_FEEDBACK_AFTER_INTERRUPT, "id": "123"}],
        thread_id=LANGGRAPH_CONFIG["thread_id"],
        meta_events=[meta_event],
        node_name="interrupted_node"
    ):
        event_dict = json.loads(event)
        events.append(event_dict)

    # Get the first LangGraph event
    langgraph_event = next(event for event in events if event.get("name") == "LangGraph")
    command_repr = langgraph_event.get("data", {}).get("input", {}).get("repr")

    # Assert that the goto node is correct
    assert command_repr == f"Command(resume='{HUMAN_FEEDBACK_AFTER_INTERRUPT}', goto='{INTERRUPTED_NODE_NAME}')"
