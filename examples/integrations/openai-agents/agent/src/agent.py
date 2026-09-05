"""OpenAI Agents SDK agent for the CopilotKit starter.

Uses the official `openai-agents` package
(https://github.com/openai/openai-agents-python):

    from agents import Agent, Runner
"""

from agents import Agent

agent = Agent(
    name="Assistant",
    instructions=(
        "You are a helpful assistant connected to CopilotKit. "
        "Format your responses in markdown."
    ),
)
