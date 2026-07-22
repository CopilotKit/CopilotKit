"""Register CopilotKit Intelligence as native LangGraph middleware."""

from langchain.agents import create_agent

from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware


def create_skill_agent(model, copilotkit_client, learning_container_id: str):
    """Create an example native agent with verified Registry skills."""

    middleware = createSkillRegistryMiddleware(
        copilotkit_client,
        learning_container_id,
    )
    return create_agent(model, middleware=[middleware])
