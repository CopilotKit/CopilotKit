"""Verified CopilotKit Intelligence Registry middleware for LangGraph.

create_skill_registry_middleware is the Python spelling of the normative createSkillRegistryMiddleware API.
"""

from .middleware import (
    create_skill_registry_middleware,
    createSkillRegistryMiddleware,
)

__all__ = [
    "createSkillRegistryMiddleware",
    "create_skill_registry_middleware",
]
