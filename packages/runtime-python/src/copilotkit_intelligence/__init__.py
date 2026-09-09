"""Use CopilotKit Intelligence without an agent or HTTP server."""

from .client import Intelligence, IntelligenceError, MemoryGrant

__all__ = ["Intelligence", "IntelligenceError", "MemoryGrant"]
