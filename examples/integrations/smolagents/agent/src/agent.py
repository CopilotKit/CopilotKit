"""SmolAgents agent for the CopilotKit starter.

Uses the official `smolagents` package
(https://github.com/huggingface/smolagents):

    from smolagents import CodeAgent, InferenceClientModel
"""

from smolagents import CodeAgent, InferenceClientModel

model = InferenceClientModel()

agent = CodeAgent(
    tools=[],
    model=model,
)
