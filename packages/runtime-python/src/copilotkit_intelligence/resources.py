"""Public resource shapes. Results remain dictionaries with their wire field names."""

from typing import Literal, NotRequired, TypeAlias, TypedDict


class ThreadSummary(TypedDict):
    """Thread metadata without message history."""

    id: str
    name: str | None
    lastRunAt: NotRequired[str]
    lastUpdatedAt: NotRequired[str]
    createdAt: NotRequired[str]
    updatedAt: NotRequired[str]
    archived: NotRequired[bool]
    agentId: NotRequired[str]
    createdById: NotRequired[str]
    organizationId: NotRequired[str]


class ListThreadsResponse(TypedDict):
    """A page of threads with its cursor and realtime join credentials."""

    threads: list[ThreadSummary]
    joinCode: str
    joinToken: NotRequired[str]
    nextCursor: NotRequired[str | None]


class ThreadResolution(TypedDict):
    """A thread and whether this call created it."""

    thread: ThreadSummary
    created: bool


class ThreadToolCall(TypedDict):
    """A persisted tool call with JSON-encoded arguments."""

    id: str
    name: str
    args: str


class ThreadMessage(TypedDict):
    """A persisted AG-UI message with optional structured content."""

    id: str
    role: str
    content: NotRequired[object]
    activityType: NotRequired[str]
    toolCalls: NotRequired[list[ThreadToolCall]]
    toolCallId: NotRequired[str]


class ThreadMessagesResponse(TypedDict):
    """Persisted messages in chronological order."""

    messages: list[ThreadMessage]


class ThreadInspectEvent(TypedDict):
    """A persisted event. Additional event fields remain in the dictionary."""

    type: str


class ThreadEventsResponse(TypedDict):
    """Persisted events with decode failures and the event-cap marker."""

    events: list[ThreadInspectEvent]
    decodeErrorRowIds: list[str]
    truncated: bool


class ThreadNoSnapshot(TypedDict):
    """The thread has no state snapshot."""

    kind: Literal["no-snapshot"]


class ThreadSnapshotDecodeError(TypedDict):
    """The platform could not decode the stored snapshot."""

    kind: Literal["snapshot-decode-error"]


class ThreadSnapshot(TypedDict):
    """Folded state and the number of deltas the platform skipped."""

    kind: Literal["snapshot"]
    state: object
    skippedDeltas: int


ThreadStateResponse: TypeAlias = ThreadNoSnapshot | ThreadSnapshotDecodeError | ThreadSnapshot


class AnnotateResponse(TypedDict):
    """The annotation ID and whether the platform recognized a repeated write."""

    id: str
    duplicate: bool


class MemorySummary(TypedDict):
    """A stored memory, with an optional relevance score from recall."""

    id: str
    kind: str
    scope: str
    content: str
    sourceThreadIds: list[str]
    invalidatedAt: str | None
    score: NotRequired[float]


class ListMemoriesResponse(TypedDict):
    """Memories visible to the application user under the supplied grant."""

    memories: list[MemorySummary]


class RecallMemoriesResponse(TypedDict):
    """Memories that match a recall query, with their relevance scores."""

    memories: list[MemorySummary]


class SaveMemoryResponse(MemorySummary):
    """The saved memory and optional merge or replacement markers."""

    absorbed: NotRequired[bool]
    retiredId: NotRequired[str]
