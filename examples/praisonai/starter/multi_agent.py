"""PraisonAI Multi-Agent Team - Content Creation Pipeline

Shows how to create a team of agents that work together.
"""

from praisonaiagents import Agent, Task, PraisonAIAgents, AGUI
from fastapi import FastAPI

# Create a team of specialized agents
researcher = Agent(
    name="Researcher",
    instructions="Research topics thoroughly and provide key facts."
)

writer = Agent(
    name="Writer", 
    instructions="Write engaging content based on research provided."
)

# Define their tasks
research_task = Task(
    description="Research: {topic}",
    expected_output="Key findings and facts",
    agent=researcher
)

write_task = Task(
    description="Write an article based on the research",
    expected_output="Engaging article",
    agent=writer
)

# Create the team
team = PraisonAIAgents(
    agents=[researcher, writer],
    tasks=[research_task, write_task]
)

# Expose via AG-UI
app = FastAPI()
app.include_router(AGUI(agents=team).get_router())

# Run: uvicorn multi_agent:app --reload
