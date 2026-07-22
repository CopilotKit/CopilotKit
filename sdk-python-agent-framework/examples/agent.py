"""Register the adapter through Microsoft Agent Framework's native option."""

from agent_framework import BaseAgent
from copilotkit import AsyncCopilotKitIntelligence
from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider


copilotkit_client = AsyncCopilotKitIntelligence(
    api_key="...",
    project_namespace="my-project",
)
provider = SkillRegistryContextProvider(
    copilotkit_client,
    "55555555-5555-4555-8555-555555555555",
)
agent = BaseAgent(name="assistant", context_providers=[provider])
