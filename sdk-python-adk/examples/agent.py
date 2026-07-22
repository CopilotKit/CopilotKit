"""Register verified CopilotKit Intelligence skills with a native ADK agent."""

from copilotkit_intelligence_adk import SkillRegistry, SkillToolset
from google.adk.agents import LlmAgent


def create_agent(copilotkit_client, learning_container_id: str) -> LlmAgent:
    registry = SkillRegistry(copilotkit_client, learning_container_id)
    return LlmAgent(name="skill_agent", tools=[SkillToolset(registry)])
