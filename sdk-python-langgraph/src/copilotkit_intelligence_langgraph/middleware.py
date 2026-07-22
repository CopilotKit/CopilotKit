"""Native LangGraph middleware backed by verified Registry snapshots."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

from langchain.agents.middleware import AgentMiddleware, ModelRequest
from langchain_core.messages import SystemMessage

from ._registry_state import (
    MAXIMUM_CONTEXT_BYTES,
    MAXIMUM_SKILL_BYTES,
    MAXIMUM_SKILLS,
    RegistrySnapshot,
    RegistryState,
    Status,
    TelemetrySink,
)


class _SkillRegistryMiddleware(AgentMiddleware):
    def __init__(self, state: RegistryState) -> None:
        self._state = state

    @property
    def ready(self) -> bool:
        return self._state.ready

    @property
    def status(self) -> Status:
        return self._state.status

    @property
    def snapshot(self) -> RegistrySnapshot:
        return self._state.snapshot

    async def preload(self) -> RegistrySnapshot:
        return await self._state.preload()

    async def preload_cached(self) -> RegistrySnapshot:
        return await self._state.preload_cached()

    async def load(self) -> RegistrySnapshot:
        return await self._state.load()

    async def wait_until_ready(self, timeout: float | None = None) -> RegistrySnapshot:
        return await self._state.wait_until_ready(timeout)

    async def aclose(self) -> None:
        await self._state.aclose()

    @staticmethod
    def _with_prompt(request: ModelRequest, prompt: str) -> ModelRequest:
        if not prompt:
            return request
        current = request.system_message
        if current is None:
            message = SystemMessage(content=prompt)
        elif isinstance(current.content, str):
            separator = "\n\n" if current.content else ""
            message = current.model_copy(
                update={"content": f"{current.content}{separator}{prompt}"}
            )
        else:
            message = current.model_copy(
                update={
                    "content": [
                        *current.content,
                        {"type": "text", "text": prompt},
                    ]
                }
            )
        return request.override(system_message=message)

    def wrap_model_call(self, request, handler):
        snapshot = asyncio.run(self._state.load())
        return handler(self._with_prompt(request, snapshot.prompt))

    async def awrap_model_call(self, request, handler):
        snapshot = await self._state.load()
        return await handler(self._with_prompt(request, snapshot.prompt))


def createSkillRegistryMiddleware(
    client: Any,
    learning_container_id: str,
    *,
    refresh_interval: float = 30.0,
    maximum_skills: int = MAXIMUM_SKILLS,
    maximum_skill_bytes: int = MAXIMUM_SKILL_BYTES,
    maximum_context_bytes: int = MAXIMUM_CONTEXT_BYTES,
    clock: Callable[[], float] = time.monotonic,
    telemetry: TelemetrySink | None = None,
) -> _SkillRegistryMiddleware:
    """Create native LangGraph middleware for verified Registry skills."""

    return _SkillRegistryMiddleware(
        RegistryState(
            client,
            learning_container_id,
            refresh_interval=refresh_interval,
            maximum_skills=maximum_skills,
            maximum_skill_bytes=maximum_skill_bytes,
            maximum_context_bytes=maximum_context_bytes,
            clock=clock,
            telemetry=telemetry,
        )
    )


create_skill_registry_middleware = createSkillRegistryMiddleware
