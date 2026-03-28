"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import os

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from src.query import query_data
from src.todos import AgentState, todo_tools
from src.form import generate_form

def _build_llm():
    """OpenAI by default; set LLM_PROVIDER=qwen to use Qwen via DashScope (OpenAI-compatible API)."""
    provider = os.getenv("LLM_PROVIDER", "openai").lower().strip()
    if provider == "qwen":
        key = os.getenv("DASHSCOPE_API_KEY")
        if not key:
            raise ValueError(
                "LLM_PROVIDER=qwen requires DASHSCOPE_API_KEY (set it in .env at examples/integrations/langgraph-python/.env)."
            )
        return ChatOpenAI(
            model=os.getenv("QWEN_MODEL", "qwen-plus"),
            base_url=os.getenv(
                "DASHSCOPE_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            api_key=key,
        )
    return "openai:gpt-4.1"

agent = create_agent(
    model=_build_llm(),
    tools=[query_data, *todo_tools, generate_form],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt="""
        You are a polished, professional demo assistant using CopilotKit and LangGraph. Only mention either when necessary.

        Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

        When demonstrating charts, always call the query_data tool to fetch data first.
        When asked to manage todos, enable app mode first, then manage todos.
    """,
)

graph = agent
