"""
LangGraph agent for the CopilotKit Showcase.

Uses langgraph.prebuilt.create_react_agent with state_modifier for the system prompt.
"""

from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

from src.agents.tools import query_data, get_weather, schedule_meeting
from src.agents.todos import todo_tools, AgentState
from src.agents.a2ui_fixed_schema import search_flights
from src.agents.a2ui_dynamic_schema import generate_a2ui

SYSTEM_PROMPT = """You are a polished, professional demo assistant for CopilotKit.
Keep responses brief and clear -- 1 to 2 sentences max.

You can:
- Chat naturally with the user
- Change the UI background when asked (via frontend tool)
- Query data and render charts (via query_data tool)
- Get weather information (via get_weather tool)
- Schedule meetings with the user (via schedule_meeting tool -- the user picks a time in the UI)
- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)
- Search flights and display rich A2UI cards (via search_flights tool)
- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)
- Generate step-by-step plans for user review (human-in-the-loop)
"""

model = ChatOpenAI(model="gpt-4o-mini")

graph = create_react_agent(
    model=model,
    tools=[query_data, get_weather, schedule_meeting, search_flights, generate_a2ui]
    + todo_tools,
    prompt=SYSTEM_PROMPT,
    state_schema=AgentState,
)
