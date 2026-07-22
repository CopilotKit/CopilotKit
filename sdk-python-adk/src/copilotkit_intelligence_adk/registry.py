"""Lifecycle owner for verified CopilotKit Intelligence skill snapshots."""

from __future__ import annotations

import asyncio
import inspect
import time
from dataclasses import dataclass, replace
from typing import Any, Callable, Literal

from copilotkit import (
    IntelligenceAccessDeniedError,
    IntelligenceError,
    IntelligenceIntegrityError,
    IntelligenceNotFoundError,
    IntelligenceSkillSet,
    IntelligenceUnavailableError,
)

from ._snapshot import (
    MAXIMUM_CONTEXT_BYTES,
    MAXIMUM_SKILL_BYTES,
    MAXIMUM_SKILLS,
    AdapterError,
    RenderedSkill,
    render_verified_skills,
)


Status = Literal[
    "cold",
    "loading",
    "ready",
    "refreshing",
    "stale",
    "denied",
    "revoked",
    "closed",
]
Source = Literal["fresh", "cached", "none"]
TelemetrySink = Callable[[str, dict[str, object]], object]

_ADAPTER_VERSION = "0.1.0"
_PERMANENT_CODES = frozenset(
    {
        "LEARNING_REGISTRY_DENIED",
        "LEARNING_REGISTRY_UNRECOVERABLE",
        "LEARNING_CONTAINER_ARCHIVED",
        "LEARNING_CONTAINER_PROJECT_MISMATCH",
        "LEARNING_CONTAINER_NOT_FOUND",
    }
)


@dataclass(frozen=True)
class RegistrySnapshot:
    """One atomically published immutable adapter snapshot."""

    status: Status
    source: Source
    installed_skill_set: IntelligenceSkillSet | None
    skills: tuple[RenderedSkill, ...]
    registry_revision: str | None
    last_attempt_at: float | None
    last_success_at: float | None
    error: BaseException | None


def _adapter_error(
    message: str,
    *,
    code: str,
    category: str,
    retryable: bool = False,
    cause: BaseException | None = None,
) -> AdapterError:
    error = AdapterError(message, code=code, category=category, retryable=retryable)
    if cause is not None:
        error.__cause__ = cause
    return error


def _closed_error() -> AdapterError:
    return _adapter_error(
        "The skill registry is closed",
        code="LEARNING_REGISTRY_CLOSED",
        category="lifecycle",
    )


def _is_permanent(error: BaseException) -> bool:
    # These concrete subclasses represent transient failures even though the
    # generic error base class supplies an unrecoverable default code.
    if isinstance(error, (IntelligenceUnavailableError, IntelligenceIntegrityError)):
        return False
    if isinstance(error, (IntelligenceAccessDeniedError, IntelligenceNotFoundError)):
        return True
    return isinstance(error, IntelligenceError) and (
        error.code in _PERMANENT_CODES
        or error.status in {401, 403, 404, 410}
        or error.category in {"auth", "permission", "not_found"}
    )


def _error_metadata(error: BaseException) -> dict[str, object]:
    metadata: dict[str, object] = {}
    for source, target in (
        ("code", "errorCode"),
        ("category", "errorCategory"),
        ("retryable", "retryable"),
        ("request_id", "requestId"),
        ("trace_id", "traceId"),
    ):
        value = getattr(error, source, None)
        if value is not None:
            metadata[target] = value
    return metadata


class SkillRegistry:
    """Loads verified Registry projections and atomically exposes ADK snapshots."""

    def __init__(
        self,
        client: Any,
        learning_container_id: str,
        *,
        refresh_interval: float = 30.0,
        maximum_skills: int = MAXIMUM_SKILLS,
        maximum_skill_bytes: int = MAXIMUM_SKILL_BYTES,
        maximum_context_bytes: int = MAXIMUM_CONTEXT_BYTES,
        clock: Callable[[], float] = time.monotonic,
        telemetry: TelemetrySink | None = None,
    ) -> None:
        if refresh_interval < 0:
            raise ValueError("refresh_interval must be non-negative")
        if min(maximum_skills, maximum_skill_bytes, maximum_context_bytes) <= 0:
            raise ValueError("adapter limits must be positive")
        self._client = client
        self._learning_container_id = learning_container_id
        self._refresh_interval = refresh_interval
        self._maximum_skills = maximum_skills
        self._maximum_skill_bytes = maximum_skill_bytes
        self._maximum_context_bytes = maximum_context_bytes
        self._clock = clock
        self._telemetry = telemetry
        self._lock = asyncio.Lock()
        self._condition = asyncio.Condition(self._lock)
        self._inflight: asyncio.Task[RegistrySnapshot] | None = None
        self._joined_callers = 1
        self._accepting_joins = False
        self._join_telemetry_tasks: list[asyncio.Task[None]] = []
        self._snapshot = RegistrySnapshot(
            status="cold",
            source="none",
            installed_skill_set=None,
            skills=(),
            registry_revision=None,
            last_attempt_at=None,
            last_success_at=None,
            error=None,
        )

    @property
    def ready(self) -> bool:
        return self._snapshot.status in {"ready", "revoked"}

    @property
    def status(self) -> Status:
        return self._snapshot.status

    @property
    def snapshot(self) -> RegistrySnapshot:
        return self._snapshot

    async def preload(self) -> RegistrySnapshot:
        """Always perform a fresh generic-SDK Registry load."""

        return await self._start_or_join(cached=False, force=True, source="preload")

    async def preload_cached(self) -> RegistrySnapshot:
        """Explicitly load only the generic SDK's verified offline cache."""

        return await self._start_or_join(cached=True, force=True, source="preload")

    async def load(self) -> RegistrySnapshot:
        """Return a fresh snapshot or await one throttled network refresh."""

        return await self._start_or_join(cached=False, force=False, source="load")

    async def wait_until_ready(self, timeout: float | None = None) -> RegistrySnapshot:
        """Wait for ready/revoked, reject terminal unusable states, or time out."""

        current = self._snapshot
        if current.status not in {"cold", "loading", "refreshing"}:
            return self._usable_snapshot(current)

        async def wait() -> RegistrySnapshot:
            async with self._condition:
                while self._snapshot.status in {"cold", "loading", "refreshing"}:
                    await self._condition.wait()
                return self._usable_snapshot(self._snapshot)

        try:
            return await asyncio.wait_for(wait(), timeout=timeout)
        except asyncio.TimeoutError as error:
            failure = _adapter_error(
                "Timed out waiting for the skill registry",
                code="LEARNING_REGISTRY_READINESS_TIMEOUT",
                category="availability",
                retryable=True,
                cause=error,
            )
            raise failure from error

    async def aclose(self) -> None:
        """Close idempotently without cancelling an already-running invocation."""

        async with self._condition:
            if self._snapshot.status == "closed":
                return
            self._snapshot = RegistrySnapshot(
                status="closed",
                source="none",
                installed_skill_set=None,
                skills=(),
                registry_revision=None,
                last_attempt_at=self._snapshot.last_attempt_at,
                last_success_at=self._snapshot.last_success_at,
                error=_closed_error(),
            )
            self._condition.notify_all()
        await self._emit("status.changed", status="closed")

    async def _start_or_join(
        self, *, cached: bool, force: bool, source: str
    ) -> RegistrySnapshot:
        throttled: RegistrySnapshot | None = None
        async with self._lock:
            current = self._snapshot
            if current.status == "closed":
                raise current.error or _closed_error()
            if current.status == "denied":
                assert current.error is not None
                raise current.error
            if (
                self._inflight is not None
                and not self._inflight.done()
                and self._accepting_joins
            ):
                task = self._inflight
                self._joined_callers += 1
                self._join_telemetry_tasks.append(
                    asyncio.create_task(
                        self._emit(
                            "load.singleflight_joined",
                            joinedCallers=self._joined_callers,
                        )
                    )
                )
            elif self._inflight is not None and not self._inflight.done():
                # The shared task is completing and has atomically closed its
                # join-telemetry gate. A tail waiter can still share its exact
                # result without creating an event that the task cannot drain.
                task = self._inflight
            elif (
                not force
                and current.last_attempt_at is not None
                and self._clock() - current.last_attempt_at < self._refresh_interval
            ):
                task = None
                throttled = current
            else:
                self._joined_callers = 1
                self._accepting_joins = True
                self._join_telemetry_tasks = []
                task = asyncio.create_task(
                    self._perform_load(cached=cached, requested_source=source)
                )
                self._inflight = task

        if throttled is not None:
            await self._emit(
                "load.throttled",
                source=(
                    "refresh"
                    if source == "load" and throttled.status == "stale"
                    else source
                ),
            )
            return self._usable_snapshot(throttled)
        assert task is not None
        try:
            return await asyncio.shield(task)
        finally:
            async with self._lock:
                if self._inflight is task and task.done():
                    self._inflight = None

    async def _perform_load(
        self, *, cached: bool, requested_source: str
    ) -> RegistrySnapshot:
        started = self._clock()
        prior = self._snapshot
        loading_status: Status = "loading" if prior.status == "cold" else "refreshing"
        async with self._condition:
            if self._snapshot.status == "closed":
                raise self._snapshot.error or _closed_error()
            prior = self._snapshot
            self._snapshot = replace(
                prior,
                status=loading_status,
                last_attempt_at=started,
                error=None,
            )
            self._condition.notify_all()
        telemetry_source = self._telemetry_source(requested_source, prior.status)

        try:
            await self._emit("load.started", source=telemetry_source)
            skill_set = await self._call_generic(cached=cached)
            rendered = render_verified_skills(
                skill_set,
                maximum_skills=self._maximum_skills,
                maximum_skill_bytes=self._maximum_skill_bytes,
                maximum_context_bytes=self._maximum_context_bytes,
            )
            await self._drain_join_telemetry()
            finished = self._clock()
            result = RegistrySnapshot(
                status="revoked" if skill_set.revoked else "ready",
                source="cached" if cached else "fresh",
                installed_skill_set=skill_set,
                skills=rendered,
                registry_revision=skill_set.registry_revision,
                last_attempt_at=started,
                last_success_at=finished,
                error=None,
            )
            async with self._condition:
                closed = self._snapshot.status == "closed"
                if not closed:
                    self._snapshot = result
                self._condition.notify_all()
            if closed:
                return result
            await self._emit("status.changed", status=result.status)
            if self._snapshot.status == "closed":
                return result
            await self._emit(
                "load.succeeded",
                outcome="success",
                freshness=result.source,
                skillCount=len(result.skills),
                registryRevision=result.registry_revision,
                latencyMs=max(0, int((finished - started) * 1000)),
            )
            return result
        except BaseException as error:
            if isinstance(error, asyncio.CancelledError):
                raise
            try:
                await self._drain_join_telemetry()
            except BaseException as telemetry_error:
                if isinstance(telemetry_error, asyncio.CancelledError):
                    raise
                error = telemetry_error
            failure, status = self._classify_failure(error)
            published = await self._publish_failure(prior, started, failure, status)
            if not published:
                raise failure
            try:
                await self._emit("status.changed", status=status)
                if self._snapshot.status != "closed":
                    await self._emit(
                        "load.failed",
                        outcome="failure",
                        reason=(
                            "denied"
                            if status == "denied"
                            else (
                                "integrity"
                                if getattr(failure, "category", None) == "integrity"
                                else "transient"
                            )
                        ),
                        **_error_metadata(failure),
                    )
            except BaseException as telemetry_error:
                failure = self._telemetry_failure(telemetry_error)
                await self._publish_failure(prior, started, failure, "denied")
            raise failure

    async def _publish_failure(
        self,
        prior: RegistrySnapshot,
        started: float,
        failure: BaseException,
        status: Literal["stale", "denied"],
    ) -> bool:
        async with self._condition:
            if self._snapshot.status == "closed":
                self._condition.notify_all()
                return False
            if status == "denied":
                self._snapshot = RegistrySnapshot(
                    status="denied",
                    source="none",
                    installed_skill_set=None,
                    skills=(),
                    registry_revision=None,
                    last_attempt_at=started,
                    last_success_at=prior.last_success_at,
                    error=failure,
                )
            else:
                self._snapshot = replace(
                    prior,
                    status="stale",
                    last_attempt_at=started,
                    error=failure,
                )
            self._condition.notify_all()
            return True

    async def _drain_join_telemetry(self) -> None:
        """Fold every accepted join event into the shared operation result."""

        while True:
            async with self._lock:
                tasks = tuple(self._join_telemetry_tasks)
                self._join_telemetry_tasks.clear()
                if not tasks:
                    self._accepting_joins = False
                    return
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, BaseException):
                    raise result

    def _classify_failure(
        self, error: BaseException
    ) -> tuple[BaseException, Literal["stale", "denied"]]:
        if (
            isinstance(error, AdapterError)
            and error.code == "LEARNING_TELEMETRY_SINK_FAILED"
        ):
            return error, "denied"
        if _is_permanent(error):
            return error, "denied"
        if isinstance(error, AdapterError):
            # Rendering/validation failures are deterministic failures of the
            # verified projection. They must fail the complete set closed, not
            # be treated as an unavailable refresh that may later recover.
            return error, "denied"
        if isinstance(error, IntelligenceIntegrityError):
            return (
                _adapter_error(
                    "The refreshed Registry snapshot failed integrity verification",
                    code="LEARNING_REGISTRY_STALE",
                    category="integrity",
                    retryable=False,
                    cause=error,
                ),
                "stale",
            )
        retryable = isinstance(error, IntelligenceUnavailableError) or bool(
            getattr(error, "retryable", False)
        )
        return (
            _adapter_error(
                "The refreshed Registry snapshot is unavailable",
                code="LEARNING_REGISTRY_STALE",
                category="availability",
                retryable=retryable,
                cause=error,
            ),
            "stale",
        )

    async def _call_generic(self, *, cached: bool) -> IntelligenceSkillSet:
        method = self._client.skills.get_cached if cached else self._client.skills.get
        if inspect.iscoroutinefunction(method):
            result = await method(self._learning_container_id)
        else:
            result = await asyncio.to_thread(method, self._learning_container_id)
        if inspect.isawaitable(result):
            result = await result
        if not isinstance(result, IntelligenceSkillSet):
            raise TypeError("generic SDK returned an invalid skill set")
        return result

    def _usable_snapshot(self, snapshot: RegistrySnapshot) -> RegistrySnapshot:
        if snapshot.status in {"ready", "revoked"}:
            return snapshot
        if snapshot.error is not None:
            raise snapshot.error
        raise _adapter_error(
            "The skill registry is not ready",
            code="LEARNING_REGISTRY_STALE",
            category="availability",
            retryable=True,
        )

    @staticmethod
    def _telemetry_source(requested: str, prior_status: Status) -> str:
        if requested == "load" and prior_status != "cold":
            return "refresh"
        return requested

    async def _emit(self, name: str, **metadata: object) -> None:
        if self._telemetry is None:
            return
        record = {
            "framework": "google-adk",
            "adapterVersion": _ADAPTER_VERSION,
            **{key: value for key, value in metadata.items() if value is not None},
        }
        try:
            result = self._telemetry(name, record)
            if inspect.isawaitable(result):
                await result
        except BaseException as error:
            if isinstance(error, asyncio.CancelledError):
                raise
            raise self._telemetry_failure(error) from error

    @staticmethod
    def _telemetry_failure(error: BaseException) -> AdapterError:
        if (
            isinstance(error, AdapterError)
            and error.code == "LEARNING_TELEMETRY_SINK_FAILED"
        ):
            return error
        return _adapter_error(
            "The adapter telemetry sink failed",
            code="LEARNING_TELEMETRY_SINK_FAILED",
            category="internal",
            cause=error,
        )
