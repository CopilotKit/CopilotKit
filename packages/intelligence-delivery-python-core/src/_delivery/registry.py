"""Private asyncio registry with immutable snapshots and one shared refresh."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from time import monotonic, time
from typing import Literal

from copilotkit_intelligence import Intelligence, LearnedSkillsError, LearnedSkillsErrorCode

from .config import resolve_config
from .snapshot import VerifiedSnapshot, invalid_snapshot, validate_snapshot

logger = logging.getLogger(__name__)
_TRANSIENT = frozenset({"NETWORK_ERROR", "TIMEOUT", "INVALID_SNAPSHOT", "UNSUPPORTED_SERVER"})


@dataclass(frozen=True, slots=True)
class ErrorStatus:
    code: LearnedSkillsErrorCode
    message: str
    retryable: bool


@dataclass(frozen=True, slots=True)
class Status:
    initialized: bool
    revision: str | None
    mode: Literal["latest", "pinned"]
    last_checked_at: str | None
    stale: bool
    last_error: ErrorStatus | None


def _consume(task: asyncio.Task[VerifiedSnapshot]) -> None:
    """Observe abandoned task failures without logging exception content."""
    if not task.cancelled():
        task.exception()


class Registry:
    """Internal registry, vendored into each framework's private delivery namespace."""

    def __init__(
        self,
        *,
        client: Intelligence | None = None,
        api_key: str | None = None,
        api_url: str | None = None,
        container_id: str | None = None,
        revision: str | None = None,
        freshness_window: float = 5,
        request_timeout: float = 5,
        debug: bool = False,
    ) -> None:
        self._config = resolve_config(
            client=client,
            api_key=api_key,
            api_url=api_url,
            container_id=container_id,
            revision=revision,
            freshness_window=freshness_window,
            request_timeout=request_timeout,
            debug=debug,
        )
        self._snapshot: VerifiedSnapshot | None = None
        self._inflight: asyncio.Task[VerifiedSnapshot] | None = None
        self._checked: float | None = None
        self._checked_at: str | None = None
        self._stale = False
        self._error: ErrorStatus | None = None
        self._blocked: ErrorStatus | None = None
        self._closed = False

    @property
    def status(self) -> Status:
        return Status(
            self._snapshot is not None,
            self._snapshot.revision if self._snapshot else None,
            "pinned" if self._config.revision is not None else "latest",
            self._checked_at,
            self._stale,
            self._error,
        )

    async def initialize(self) -> None:
        await self.acquire_snapshot()

    async def acquire_snapshot(self) -> VerifiedSnapshot:
        if self._closed:
            raise LearnedSkillsError("INVALID_CONFIG", False)
        if self._inflight is None:
            if (
                self._snapshot is not None
                and self._blocked is None
                and self._checked is not None
                and monotonic() - self._checked < self._config.freshness_window
            ):
                return self._snapshot
            self._inflight = asyncio.create_task(self._refresh())
            self._inflight.add_done_callback(self._finished)
        # One cancelled invocation must not cancel another invocation's refresh.
        return await asyncio.shield(self._inflight)

    def _finished(self, task: asyncio.Task[VerifiedSnapshot]) -> None:
        if self._inflight is task:
            self._inflight = None
        _consume(task)

    async def aclose(self) -> None:
        self._closed = True
        if self._inflight is not None:
            self._inflight.cancel()
            await asyncio.gather(self._inflight, return_exceptions=True)
        if self._config.owns_client:
            await self._config.client.aclose()

    async def _load(self, started: float) -> VerifiedSnapshot:
        response = await self._config.client.get_learned_skills_snapshot(
            container_id=self._config.container_id,
            revision=self._config.revision,
            if_none_match=self._snapshot.etag if self._snapshot else None,
            request_timeout=self._config.request_timeout,
        )
        if not isinstance(response, dict):
            raise invalid_snapshot()
        if response.get("status") == "unchanged":
            if (
                self._snapshot is None
                or response.get("revision") != self._snapshot.revision
                or response.get("etag") != self._snapshot.etag
            ):
                raise invalid_snapshot()
            return self._snapshot
        if self._config.revision is not None and response.get("revision") != self._config.revision:
            raise invalid_snapshot()
        # Capture metadata and owned bytes before handing work to another thread.
        # A caller-owned response dictionary must not change an exact pin in flight.
        raw = response.get("bytes")
        if not isinstance(raw, (bytes, bytearray)):
            raise invalid_snapshot()
        captured = {
            "status": response.get("status"),
            "bytes": bytes(raw),
            "revision": response.get("revision"),
            "etag": response.get("etag"),
            "contentType": response.get("contentType"),
        }
        remaining = self._config.request_timeout - (monotonic() - started)
        if remaining <= 0:
            raise LearnedSkillsError("TIMEOUT", True)
        async with asyncio.timeout(remaining):
            snapshot = await asyncio.to_thread(validate_snapshot, captured)
        if self._config.revision is not None and snapshot.revision != self._config.revision:
            raise invalid_snapshot()
        return snapshot

    async def _refresh(self) -> VerifiedSnapshot:
        started = monotonic()
        try:
            # The canonical client owns the HTTP deadline. A second timer would
            # race confirmed denial against transport cleanup. Validation uses
            # only the remaining portion of this same invocation budget.
            snapshot = await self._load(started)
            self._snapshot = snapshot
            self._checked = monotonic()
            self._checked_at = (
                datetime.fromtimestamp(time(), UTC)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            )
            self._stale = False
            self._error = self._blocked = None
            self._debug("checked", started)
            return snapshot
        except asyncio.CancelledError:
            raise
        except Exception as cause:
            error = (
                cause
                if isinstance(cause, LearnedSkillsError)
                else LearnedSkillsError(
                    "TIMEOUT" if isinstance(cause, TimeoutError) else "NETWORK_ERROR", True, cause
                )
            )
            info = ErrorStatus(error.code, error.message, error.retryable)
            if error.code not in _TRANSIENT:
                self._blocked = info
            self._error = self._blocked if self._blocked is not None else info
            self._debug("failed", started)
            if self._blocked is not None:
                self._stale = False
                blocked = self._blocked
                raise LearnedSkillsError(blocked.code, blocked.retryable, error.cause) from None
            if self._snapshot is not None:
                self._stale = True
                return self._snapshot
            raise error from None

    def _debug(self, event: str, started: float) -> None:
        if self._config.debug:
            logger.debug(
                "Learned skills %s container=%s revision=%s duration_ms=%.1f error_code=%s",
                event,
                self._config.container_id,
                self._snapshot.revision if self._snapshot else None,
                (monotonic() - started) * 1000,
                self._error.code if self._error else None,
            )
