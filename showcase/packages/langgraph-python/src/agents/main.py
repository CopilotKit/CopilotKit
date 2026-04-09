"""
LangGraph agent for the CopilotKit Showcase.

Uses langgraph.prebuilt.create_react_agent with state_modifier for the system prompt.
"""

from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

from src.agents.tools import query_data, get_weather

SYSTEM_PROMPT = """You are a polished, professional demo assistant for CopilotKit.
Keep responses brief and clear -- 1 to 2 sentences max.

You can:
- Chat naturally with the user
- Change the UI background when asked (via frontend tool)
- Query data and render charts (via query_data tool)
- Get weather information (via get_weather tool)
- Generate step-by-step plans for user review (human-in-the-loop)
"""

model = ChatOpenAI(model="gpt-4o-mini")

graph = create_react_agent(
    model=model,
    tools=[query_data, get_weather],
    prompt=SYSTEM_PROMPT,
)
