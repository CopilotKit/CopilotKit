"""
Reproduction: recursion_limit=100 ignored, default 25 enforced.

Reporter's architecture:
  Frontend (useCoAgent) → TS LangGraphAgent → LangGraph Platform (remote)

This reproduction's architecture:
  Frontend (useCoAgent) → LangGraphHttpAgent → local Python agent (this file)

The graph deterministically loops 30 times (exceeding the default limit of 25).
  - Scenario A: config={"recursion_limit": 100} on LangGraphAGUIAgent → succeeds
  - Scenario B: no config (default 25), frontend sends recursion_limit: 100
    via useCoAgent config but it never reaches astream_events() → fails at 25

Graph: init_node → loop_node (loops until counter >= target) → report_node → END
"""

from fastapi import FastAPI
from typing import Annotated, TypedDict
from copilotkit import LangGraphAGUIAgent
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from langchain_core.messages import AIMessage, BaseMessage

app = FastAPI()

TARGET_ITERATIONS = 30  # Exceeds default recursion_limit of 25

print(f"[tkt-recursion-limit agent] Initializing — target iterations: {TARGET_ITERATIONS}")


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    counter: int
    target: int
    status: str


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

def init_node(state: AgentState) -> dict:
    """Initialize the loop counter on first entry."""
    counter = state.get("counter", 0)
    target = state.get("target", TARGET_ITERATIONS)
    print(f"[tkt-recursion-limit agent] init_node: counter={counter}, target={target}")
    return {
        "counter": 0,
        "target": target,
        "status": "running",
    }


def loop_node(state: AgentState) -> dict:
    """Increment counter. This node is visited once per graph step."""
    counter = state.get("counter", 0) + 1
    target = state.get("target", TARGET_ITERATIONS)
    print(f"[tkt-recursion-limit agent] loop_node: step {counter}/{target}")
    return {
        "counter": counter,
        "status": "running" if counter < target else "done",
    }


def report_node(state: AgentState) -> dict:
    """Final node — emit a summary message."""
    counter = state.get("counter", 0)
    target = state.get("target", TARGET_ITERATIONS)
    msg = f"Loop completed: {counter}/{target} iterations. The recursion_limit was sufficient."
    print(f"[tkt-recursion-limit agent] report_node: {msg}")
    return {
        "messages": [AIMessage(content=msg)],
        "status": "complete",
    }


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

def should_continue(state: AgentState) -> str:
    counter = state.get("counter", 0)
    target = state.get("target", TARGET_ITERATIONS)
    decision = "loop_node" if counter < target else "report_node"
    if counter % 5 == 0 or decision == "report_node":
        print(f"[tkt-recursion-limit agent] should_continue: counter={counter}/{target} → {decision}")
    return decision


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------

builder = StateGraph(AgentState)
builder.add_node("init_node", init_node)
builder.add_node("loop_node", loop_node)
builder.add_node("report_node", report_node)

builder.set_entry_point("init_node")
builder.add_edge("init_node", "loop_node")
builder.add_conditional_edges("loop_node", should_continue, {
    "loop_node": "loop_node",
    "report_node": "report_node",
})
builder.add_edge("report_node", END)


# ---------------------------------------------------------------------------
# Scenario A: recursion_limit=100 set on LangGraphAGUIAgent config
#   This is the workaround — set the limit where the graph executes.
#   In the reporter's architecture (LangGraph Platform), the equivalent
#   would be setting recursion_limit in the assistant's config on the Platform.
# ---------------------------------------------------------------------------

graph_a = builder.compile(checkpointer=MemorySaver())

agent_a_config = {"recursion_limit": 100}
print(f"[tkt-recursion-limit agent] Scenario A config: {agent_a_config}")

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="with_limit",
        description="Agent with recursion_limit=100 on agent config (workaround)",
        graph=graph_a,
        config=agent_a_config,
    ),
    "/with-limit",
)
print("[tkt-recursion-limit agent] Scenario A mounted at /with-limit (recursion_limit=100)")


# ---------------------------------------------------------------------------
# Scenario B: NO recursion_limit on agent config (default 25)
#   This reproduces the reporter's bug. The frontend sends
#   recursion_limit: 100 via useCoAgent config, but it never reaches
#   graph.astream_events(). The default of 25 is enforced.
#
#   In the reporter's architecture, the TS LangGraphAgent.assistantConfig
#   ALSO sets recursion_limit: 100. That code path (mergeConfigs →
#   client.runs.stream) looks correct but cannot be tested without
#   LangGraph Platform.
# ---------------------------------------------------------------------------

graph_b = builder.compile(checkpointer=MemorySaver())

print("[tkt-recursion-limit agent] Scenario B config: (none — default 25)")

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="without_limit",
        description="Agent WITHOUT recursion_limit — relies on frontend config (will fail at 25)",
        graph=graph_b,
    ),
    "/without-limit",
)
print("[tkt-recursion-limit agent] Scenario B mounted at /without-limit (no config — default 25)")
