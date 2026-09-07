"""Preserve Responses-stream identity while capturing reasoning text."""

from __future__ import annotations

from typing import Any


_REASONING_DELTA_TYPES = {
    "response.reasoning_summary_text.delta",
    "response.reasoning_text.delta",
}


class ResponsesReasoningCapture:
    """Transparent async iterator that records Responses reasoning deltas.

    ``ag-ui-crewai`` recognizes LiteLLM Responses streams by their private
    ``_process_chunk`` capability. Mirroring that capability keeps the stream
    on the SDK's Responses decoder instead of misclassifying it as chat.
    """

    def __init__(self, source: Any):
        self._iterator = source.__aiter__()
        self._process_chunk = source._process_chunk
        self.reasoning_parts: list[str] = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        event = await self._iterator.__anext__()
        event_type = getattr(event, "type", None)
        event_type = str(getattr(event_type, "value", event_type))
        delta = getattr(event, "delta", None)
        if event_type in _REASONING_DELTA_TYPES and isinstance(delta, str) and delta:
            self.reasoning_parts.append(delta)
        return event
