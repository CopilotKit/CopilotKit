"""
LangGraph agent for the CopilotKit Showcase.

Uses langgraph.prebuilt.create_react_agent with state_modifier for the system prompt.
"""

from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

from src.agents.tools import query_data, get_weather, schedule_meeting

try:
    from src.agents.a2ui_fixed_schema import search_flights
except Exception:
    search_flights = None

try:
    from src.agents.a2ui_dynamic_schema import generate_a2ui
except Exception:
    generate_a2ui = None

# Import todo_tools but not custom AgentState — newer langgraph requires
# remaining_steps in state_schema which the custom schema doesn't have
try:
    from src.agents.todos import todo_tools
except Exception:
    todo_tools = []

SYSTEM_PROMPT = """You are a polished, professional demo assistant for CopilotKit.
Keep responses brief and clear -- 1 to 2 sentences max.

You can:
- Chat naturally with the user
- Change the UI background when asked (via frontend tool)
- Query data and render charts:
  1. Call query_data ONCE to fetch the dataset.
  2. Then call the pieChart or barChart frontend tool to display the results.
  Do NOT call query_data more than once per chart request.
- Get weather information (via get_weather tool)
- Schedule meetings with the user (via schedule_meeting tool -- the user picks a time in the UI)
- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)
- Search flights and display rich A2UI cards (via search_flights tool)
- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)
- Generate step-by-step plans for user review (human-in-the-loop)

IMPORTANT: pieChart and barChart are frontend tools provided by CopilotKit.
After fetching data with query_data, you MUST call pieChart or barChart to render charts.
Never loop on query_data -- call it once, then render.
"""

model = ChatOpenAI(model="gpt-4o-mini")

graph = create_react_agent(
    model=model,
    tools=[t for t in [query_data, get_weather, schedule_meeting, search_flights, generate_a2ui] if t]
    + todo_tools,
    prompt=SYSTEM_PROMPT,
)
