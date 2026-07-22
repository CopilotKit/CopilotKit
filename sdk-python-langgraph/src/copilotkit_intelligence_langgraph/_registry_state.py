"""Lifecycle and rendering for verified Intelligence Registry skill snapshots."""

from __future__ import annotations

import asyncio
import importlib.metadata
import inspect
import json
import time
import unicodedata
from dataclasses import dataclass, replace
from pathlib import PurePosixPath
from typing import Any, Callable, Literal

from copilotkit import (
    IntelligenceAccessDeniedError,
    IntelligenceError,
    IntelligenceIntegrityError,
    IntelligenceNotFoundError,
    IntelligenceSkillSet,
    IntelligenceUnavailableError,
)


MAXIMUM_SKILLS = 128
MAXIMUM_SKILL_BYTES = 262_144
MAXIMUM_CONTEXT_BYTES = 1_048_576
_DISTRIBUTION_NAME = "copilotkit-intelligence-langgraph"
_SOURCE_TREE_VERSION = "0.1.0"


def _resolve_adapter_version() -> str:
    try:
        return importlib.metadata.version(_DISTRIBUTION_NAME)
    except importlib.metadata.PackageNotFoundError:
        return _SOURCE_TREE_VERSION


ADAPTER_VERSION = _resolve_adapter_version()

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

_PERMANENT_CODES = frozenset(
    {
        "LEARNING_REGISTRY_DENIED",
        "LEARNING_REGISTRY_UNRECOVERABLE",
        "LEARNING_CONTAINER_ARCHIVED",
        "LEARNING_CONTAINER_PROJECT_MISMATCH",
        "LEARNING_CONTAINER_NOT_FOUND",
    }
)


class AdapterError(RuntimeError):
    """Canonical adapter-local failure without a wire-protocol dependency."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        category: str,
        retryable: bool = False,
        status: int | None = None,
        request_id: str | None = None,
        trace_id: str | None = None,
        cause_identity: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.category = category
        self.retryable = retryable
        self.status = status
        self.request_id = request_id
        self.trace_id = trace_id
        self.cause_identity = cause_identity


@dataclass(frozen=True)
class RenderedSkill:
    """One deterministic instruction record in Registry projection order."""

    position: int
    name: str
    text: str
    byte_length: int
    skill_id: str
    version_id: str
    description: str | None
    kind: str = "instruction"

    def as_native(self) -> dict[str, object]:
        return {
            "position": self.position,
            "kind": self.kind,
            "name": self.name,
            "text": self.text,
            "byteLength": self.byte_length,
            "skillId": self.skill_id,
            "versionId": self.version_id,
            "description": self.description,
        }


@dataclass(frozen=True)
class RegistrySnapshot:
    """One atomically published immutable adapter snapshot."""

    status: Status
    source: Source
    installed_skill_set: IntelligenceSkillSet | None
    rendered_skills: tuple[RenderedSkill, ...]
    prompt: str
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
    cause_identity: str | None = None,
) -> AdapterError:
    error = AdapterError(
        message,
        code=code,
        category=category,
        retryable=retryable,
        cause_identity=cause_identity,
    )
    if cause is not None:
        error.__cause__ = cause
    return error


def _closed_error() -> AdapterError:
    return _adapter_error(
        "The skill registry is closed",
        code="LEARNING_REGISTRY_CLOSED",
        category="lifecycle",
        cause_identity="closed-1",
    )


def _validation_error(
    message: str,
    code: str,
    category: str = "validation",
    cause_identity: str | None = None,
) -> AdapterError:
    return _adapter_error(
        message, code=code, category=category, cause_identity=cause_identity
    )


def _contains_disabled_script(descriptor: Any) -> bool:
    for file in descriptor.manifest.files:
        normalized = unicodedata.normalize("NFC", file.path)
        parts = PurePosixPath(normalized).parts
        if file.role.casefold() == "script":
            return True
        if parts and parts[0].casefold() == "scripts":
            return True
    return False


def _render_prompt(skills: tuple[RenderedSkill, ...]) -> str:
    if not skills:
        return ""
    records = ["CopilotKit Intelligence Registry skills (verified, ordered):"]
    for skill in skills:
        name = json.dumps(skill.name, ensure_ascii=False, separators=(",", ":"))
        description = json.dumps(
            skill.description, ensure_ascii=False, separators=(",", ":")
        )
        records.append(
            f'<skill id="{skill.skill_id}" version="{skill.version_id}" '
            f"name={name} description={description}>\n"
            f"{skill.text}</skill>"
        )
    return "\n\n".join(records)


def render_verified_skills(
    skill_set: IntelligenceSkillSet,
    *,
    maximum_skills: int,
    maximum_skill_bytes: int,
    maximum_context_bytes: int,
) -> tuple[RenderedSkill, ...]:
    """Render a complete set only from immutable verified descriptors."""

    descriptors = skill_set.skill_descriptors
    if skill_set.skills and not descriptors:
        raise _validation_error(
            "The generic SDK did not provide verified skill descriptors",
            "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION",
            cause_identity="unsupported-sdk-projection-1",
        )
    if len(descriptors) > maximum_skills:
        raise _validation_error(
            "The verified Registry set exceeds the adapter skill limit",
            "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS",
            cause_identity=f"count-{len(descriptors)}",
        )
    if any(_contains_disabled_script(descriptor) for descriptor in descriptors):
        raise _validation_error(
            "Executable skill artifacts are disabled by this adapter",
            "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED",
            cause_identity="script-disabled-1",
        )

    rendered: list[RenderedSkill] = []
    aggregate = 0
    for expected_position, descriptor in enumerate(descriptors):
        if descriptor.position != expected_position:
            raise _validation_error(
                "Verified skill descriptor order is not contiguous",
                "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION",
                cause_identity="unsupported-sdk-projection-1",
            )
        try:
            contents = (descriptor.directory / "SKILL.md").read_bytes()
        except OSError as error:
            failure = _validation_error(
                "A verified SKILL.md file could not be read",
                "INTELLIGENCE_ADAPTER_INVALID_UTF8",
                "integrity",
                cause_identity="utf8-1",
            )
            raise failure from error
        if len(contents) > maximum_skill_bytes:
            raise _validation_error(
                "A verified SKILL.md exceeds the adapter byte limit",
                "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE",
                cause_identity=f"bytes-{len(contents)}",
            )
        aggregate += len(contents)
        if aggregate > maximum_context_bytes:
            raise _validation_error(
                "The rendered skill set exceeds the adapter context limit",
                "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE",
                cause_identity=f"bytes-{aggregate}",
            )
        try:
            text = contents.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            failure = _validation_error(
                "A verified SKILL.md is not strict UTF-8",
                "INTELLIGENCE_ADAPTER_INVALID_UTF8",
                "integrity",
                cause_identity="utf8-1",
            )
            raise failure from error
        rendered.append(
            RenderedSkill(
                position=descriptor.position,
                name=descriptor.name,
                text=text,
                byte_length=len(contents),
                skill_id=descriptor.skill_id,
                version_id=descriptor.version_id,
                description=descriptor.description,
            )
        )
    return tuple(rendered)


def _is_permanent(error: BaseException) -> bool:
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


class RegistryState:
    """Own one verified snapshot, throttle, and singleflight lifecycle."""

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
            rendered_skills=(),
            prompt="",
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
        return await self._start_or_join(cached=False, force=True, source="preload")

    async def preload_cached(self) -> RegistrySnapshot:
        return await self._start_or_join(cached=True, force=True, source="preload")

    async def load(self) -> RegistrySnapshot:
        return await self._start_or_join(cached=False, force=False, source="load")

    async def wait_until_ready(self, timeout: float | None = None) -> RegistrySnapshot:
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
                cause_identity="timeout-30000",
            )
            raise failure from error

    async def aclose(self) -> None:
        async with self._condition:
            if self._snapshot.status == "closed":
                return
            self._snapshot = RegistrySnapshot(
                status="closed",
                source="none",
                installed_skill_set=None,
                rendered_skills=(),
                prompt="",
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
        reentrant: RegistrySnapshot | None = None
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
                and self._inflight is asyncio.current_task()
            ):
                # A telemetry callback executes inside the shared load task. It
                # must never join and await that same task. Terminal telemetry
                # observes the snapshot already published off to the side;
                # started/failed telemetry rejects from the current fail-closed
                # lifecycle state.
                task = None
                reentrant = current
            elif (
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

        if reentrant is not None:
            return self._usable_snapshot(reentrant)
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
                prior, status=loading_status, last_attempt_at=started, error=None
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
                rendered_skills=rendered,
                prompt=_render_prompt(rendered),
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
                skillCount=len(result.rendered_skills),
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
                    rendered_skills=(),
                    prompt="",
                    registry_revision=None,
                    last_attempt_at=started,
                    last_success_at=prior.last_success_at,
                    error=failure,
                )
            else:
                self._snapshot = replace(
                    prior, status="stale", last_attempt_at=started, error=failure
                )
            self._condition.notify_all()
            return True

    async def _drain_join_telemetry(self) -> None:
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
            return error, "denied"
        if isinstance(error, IntelligenceIntegrityError):
            return (
                _adapter_error(
                    "The refreshed Registry snapshot failed integrity verification",
                    code="LEARNING_REGISTRY_STALE",
                    category="integrity",
                    retryable=False,
                    cause=error,
                    cause_identity=getattr(error, "cause_identity", None) or str(error),
                ),
                "stale",
            )
        return (
            _adapter_error(
                "The refreshed Registry snapshot is unavailable",
                code="LEARNING_REGISTRY_STALE",
                category="availability",
                retryable=isinstance(error, IntelligenceUnavailableError)
                or bool(getattr(error, "retryable", False)),
                cause=error,
                cause_identity=getattr(error, "cause_identity", None) or str(error),
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

    @staticmethod
    def _usable_snapshot(snapshot: RegistrySnapshot) -> RegistrySnapshot:
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
            "framework": "langgraph-python",
            "adapterVersion": ADAPTER_VERSION,
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
            cause_identity=getattr(error, "cause_identity", None) or str(error),
        )
