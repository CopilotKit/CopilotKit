from fastapi import FastAPI
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

print("[tkt-useagent-hitl agent] Initializing agent")

agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=[],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt=(
        "You are a helpful assistant for testing human-in-the-loop workflows.\n\n"
        "IMPORTANT: You have access to a frontend tool called 'confirmAction'.\n"
        "When the user asks you to confirm an action, do something, or make any decision,\n"
        "you MUST call the 'confirmAction' tool with:\n"
        "- action: a short description of what you want to do\n"
        "- reason: why you need the user's confirmation\n\n"
        "After the user responds through the confirmAction tool, acknowledge their decision.\n"
        "If the tool is not available, tell the user that the confirmAction tool "
        "was not found in your available tools."
    ),
)

print("[tkt-useagent-hitl agent] Agent created, adding endpoint")

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="default",
        description="HITL reproduction agent - tests whether frontend tools are forwarded",
        graph=agent,
        config={"recursion_limit": 100},
    ),
    "/",
)

print("[tkt-useagent-hitl agent] Endpoint mounted at /")
