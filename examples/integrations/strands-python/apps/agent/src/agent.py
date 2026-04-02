import json
import os

from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from strands import Agent
from strands.models.openai import OpenAIModel

from src.query import query_data
from src.todos import manage_todos, get_todos, build_todos_prompt, todos_state_from_args, todos_state_from_result
from src.form import generate_form


# Configure shared state behavior for todos
config = StrandsAgentConfig(
    state_context_builder=build_todos_prompt,
    tool_behaviors={
        "manage_todos": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=todos_state_from_args,
            state_from_result=todos_state_from_result,
        ),
        "enableAppMode": ToolBehavior(continue_after_frontend_call=True),
        "enableChatMode": ToolBehavior(continue_after_frontend_call=True),
    },
)

# Initialize OpenAI model
model = OpenAIModel(
    client_args={"api_key": os.getenv("OPENAI_API_KEY", "")},
    model_id="gpt-4.1",
)

# Create Strands agent with all tools
strands_agent = Agent(
    model=model,
    system_prompt="""
        You are a polished, professional demo assistant using CopilotKit and AWS Strands. Only mention either when necessary.

        Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

        When demonstrating charts, always call the query_data tool to fetch data first.
        When asked to manage todos, enable app mode first, then manage todos.
    """,
    tools=[query_data, manage_todos, get_todos, generate_form],
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=strands_agent,
    name="sample_agent",
    description="A demo assistant for CopilotKit features",
    config=config,
)

# Create the FastAPI app
app = create_strands_app(agui_agent)
