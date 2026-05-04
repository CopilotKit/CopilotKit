"""
Agent Spec helpers and server tools.

This module provides utilities to:
- Load the Agent Spec JSON used by the backend
- Define server-side tool implementations
- Build an AgentSpecAgent configured with the JSON spec and tools

It is used by the FastAPI app in main.py.
"""

from __future__ import annotations

from ag_ui_agentspec.agent import AgentSpecAgent


def build_a2ui_chat_agent(runtime: str = "langgraph") -> AgentSpecAgent:
    from a2ui_agentspec_agent import a2ui_demo_tool_registry, a2ui_chat_json

    return AgentSpecAgent(
        agent_spec_config=a2ui_chat_json,
        runtime=runtime,
        tool_registry=a2ui_demo_tool_registry
    )


def build_agentspec_agent(runtime: str = "langgraph") -> AgentSpecAgent:
    """Create an AgentSpecAgent configured from the JSON spec and server tools."""
    from agentspec_agent import get_weather, with_agentspec_agent_json

    return AgentSpecAgent(
        agent_spec_config=with_agentspec_agent_json,
        runtime=runtime,
        tool_registry={"get_weather": get_weather}
    )
