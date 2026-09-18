"""Use CopilotKit Intelligence without an agent or HTTP server."""

from .client import Intelligence, IntelligenceError, MemoryGrant, RuntimeEntitlementError
from .entitlements import RuntimeEntitlementResponse
from .inspector import InspectorMetadata
from .learned_skills import (
    LearnedSkillsError,
    LearnedSkillsErrorCode,
    LearnedSkillsSnapshot,
    LearnedSkillsSnapshotResult,
    LearnedSkillsUnchanged,
)
from .resources import (
    AnnotateResponse,
    ListMemoriesResponse,
    ListThreadsResponse,
    MemorySummary,
    RecallMemoriesResponse,
    SaveMemoryResponse,
    ThreadEventsResponse,
    ThreadInspectEvent,
    ThreadMessage,
    ThreadMessagesResponse,
    ThreadNoSnapshot,
    ThreadResolution,
    ThreadSnapshot,
    ThreadSnapshotDecodeError,
    ThreadStateResponse,
    ThreadSummary,
    ThreadToolCall,
)

__all__ = [
    "Intelligence",
    "LearnedSkillsError",
    "LearnedSkillsErrorCode",
    "LearnedSkillsSnapshot",
    "LearnedSkillsSnapshotResult",
    "LearnedSkillsUnchanged",
    "IntelligenceError",
    "MemoryGrant",
    "InspectorMetadata",
    "RuntimeEntitlementResponse",
    "RuntimeEntitlementError",
    "MemorySummary",
    "ListMemoriesResponse",
    "RecallMemoriesResponse",
    "SaveMemoryResponse",
    "AnnotateResponse",
    "ListThreadsResponse",
    "ThreadSummary",
    "ThreadResolution",
    "ThreadToolCall",
    "ThreadMessage",
    "ThreadMessagesResponse",
    "ThreadInspectEvent",
    "ThreadEventsResponse",
    "ThreadNoSnapshot",
    "ThreadSnapshotDecodeError",
    "ThreadSnapshot",
    "ThreadStateResponse",
]
