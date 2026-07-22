"""Native Microsoft Agent Framework provider for verified Registry skills."""

from __future__ import annotations

import time
from typing import Any, Callable

from agent_framework import AgentSession, ContextProvider, SessionContext

from ._registry_state import (
    MAXIMUM_CONTEXT_BYTES,
    MAXIMUM_SKILL_BYTES,
    MAXIMUM_SKILLS,
    RegistrySnapshot,
    RegistryState,
    Status,
    TelemetrySink,
)


class SkillRegistryContextProvider(ContextProvider):
    """Load verified CopilotKit skills before each Agent Framework model run."""

    def __init__(
        self,
        client: Any,
        learning_container_id: str,
        *,
        source_id: str = "copilotkit-intelligence-skills",
        refresh_interval: float = 30.0,
        maximum_skills: int = MAXIMUM_SKILLS,
        maximum_skill_bytes: int = MAXIMUM_SKILL_BYTES,
        maximum_context_bytes: int = MAXIMUM_CONTEXT_BYTES,
        clock: Callable[[], float] = time.monotonic,
        telemetry: TelemetrySink | None = None,
    ) -> None:
        super().__init__(source_id=source_id)
        self._registry = RegistryState(
            client,
            learning_container_id,
            refresh_interval=refresh_interval,
            maximum_skills=maximum_skills,
            maximum_skill_bytes=maximum_skill_bytes,
            maximum_context_bytes=maximum_context_bytes,
            clock=clock,
            telemetry=telemetry,
        )

    @property
    def ready(self) -> bool:
        return self._registry.ready

    @property
    def status(self) -> Status:
        return self._registry.snapshot.status

    @property
    def snapshot(self) -> RegistrySnapshot:
        return self._registry.snapshot

    async def preload(self) -> RegistrySnapshot:
        """Force a fresh generic-SDK Registry load."""

        return await self._registry.preload()

    async def preload_cached(self) -> RegistrySnapshot:
        """Load only the generic SDK's verified offline cache."""

        return await self._registry.preload_cached()

    async def load(self) -> RegistrySnapshot:
        """Return the current snapshot or perform one throttled refresh."""

        return await self._registry.load()

    async def wait_until_ready(self, timeout: float | None = None) -> RegistrySnapshot:
        """Wait for a usable ready or revoked snapshot."""

        return await self._registry.wait_until_ready(timeout)

    async def aclose(self) -> None:
        """Close idempotently while allowing in-flight invocations to finish."""

        await self._registry.aclose()

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        """Load and append one immutable skill snapshot before model context generation."""

        del agent, session, state
        snapshot = await self.load()
        context.extend_instructions(
            self.source_id, tuple(record.text for record in snapshot.skills)
        )
