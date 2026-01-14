"""PraisonAI Agent with CopilotKit - Simplest Example

Just 4 lines to create an AI agent with CopilotKit!
"""

from praisonaiagents import Agent, AGUI
from fastapi import FastAPI

# 1. Create an agent (just like the simplest PraisonAI example)
agent = Agent(instructions="You are a helpful assistant")

# 2. Expose via AG-UI for CopilotKit
app = FastAPI()
app.include_router(AGUI(agent=agent).get_router())

# Run: uvicorn agent:app --reload
