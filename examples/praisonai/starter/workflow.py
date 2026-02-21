"""PraisonAI Workflow - Pipeline of Agents

Shows how to create a workflow/pipeline of agents.
"""

from praisonaiagents import Agent, Workflow, AGUI
from fastapi import FastAPI

# Create agents for each step
analyzer = Agent(
    name="Analyzer",
    instructions="Analyze the input and identify key points."
)

summarizer = Agent(
    name="Summarizer",
    instructions="Summarize the analysis into clear bullet points."
)

# Create a workflow pipeline
workflow = Workflow(
    name="Analysis Pipeline",
    steps=[analyzer, summarizer]
)

# For CopilotKit, wrap the first agent (workflow runs internally)
app = FastAPI()
app.include_router(AGUI(agent=analyzer).get_router())

# Run: uvicorn workflow:app --reload
