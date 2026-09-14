"""Native async agents and bounded HTTP AG-UI event streaming."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from .models import Json


class Agent(Protocol):
    """Implement run as an async iterator; cancellation must close upstream work."""

    description: str

    def run(self, input: Json) -> AsyncIterator[Json]:
        """Yield AG-UI event objects for one isolated execution."""
        ...


@dataclass(frozen=True)
class HttpAgent:
    """Call an HTTP AG-UI agent without forwarding browser authentication headers."""

    url: str
    description: str = ""
    headers: dict[str, str] = field(default_factory=dict, repr=False)
    timeout: float = 120
    max_event_bytes: int = 2 * 1024 * 1024

    async def run(self, input: Json) -> AsyncIterator[Json]:
        """Parse multiline SSE data and stop on cancellation or malformed events."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                self.url,
                json=input,
                headers={"Accept": "text/event-stream", **self.headers},
            ) as response:
                response.raise_for_status()
                data: list[str] = []
                size = 0
                async for line in response.aiter_lines():
                    size += len(line.encode("utf-8"))
                    if size > self.max_event_bytes:
                        raise ValueError("Agent event exceeds configured limit")
                    if line == "":
                        if data:
                            raw = "\n".join(data)
                            if raw == "[DONE]":
                                return
                            event = json.loads(raw)
                            if not isinstance(event, dict) or not isinstance(
                                event.get("type"), str
                            ):
                                raise ValueError("Invalid AG-UI event")
                            yield event
                        data, size = [], 0
                    elif line.startswith("data:"):
                        data.append(line[5:].removeprefix(" "))
                if data:
                    raise ValueError("Agent stream ended inside an SSE event")
