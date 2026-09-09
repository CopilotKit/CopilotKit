"""Use CopilotKit Intelligence without an agent or HTTP server."""

from .client import Intelligence, IntelligenceError, MemoryGrant
from .inspector import InspectorMetadata

__all__ = ["Intelligence", "IntelligenceError", "MemoryGrant", "InspectorMetadata"]
