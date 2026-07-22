from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any

import pytest
from agent_framework import AgentSession, SessionContext
from copilotkit import (
    IntelligenceError,
    IntelligenceIntegrityError,
    IntelligenceUnavailableError,
)

from conftest import CONTAINER_ID, FakeSkillsClient, client, skill_set


CORPUS_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages/intelligence/conformance/registry-adapters-v1.json"
)
CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))

_CORPUS_FIELDS = frozenset(
    {
        "schemaVersion",
        "contractVersion",
        "distribution",
        "sourceCorpus",
        "fixtures",
        "cases",
    }
)
_CASE_FIELDS = frozenset({"name", "initialSnapshot", "operations", "expected"})
_CASE_OPTIONAL_FIELDS = frozenset({"permanentDenialSource"})
_EXPECTED_FIELDS = frozenset(
    {
        "calls",
        "statusTransitions",
        "genericSdk",
        "readiness",
        "nativeHook",
        "telemetryNames",
        "renderedRecords",
        "telemetryRecords",
    }
)
_EXPECTED_OPTIONAL_FIELDS = frozenset({"singleflight"})
_PERMANENT_DENIAL_SOURCES = frozenset(
    {
        "error-category-auth",
        "error-category-permission",
        "http-401",
        "http-403",
        "http-404",
        "http-410",
        "container-archived",
        "project-mismatch",
        "container-not-found",
        "registry-unrecoverable",
    }
)


def _assert_field_shape(
    value: dict[str, Any],
    required: frozenset[str],
    *,
    optional: frozenset[str] = frozenset(),
    label: str,
) -> None:
    actual = frozenset(value)
    missing = required - actual
    unexpected = actual - required - optional
    assert not missing and not unexpected, (
        f"{label} fields must match the conformance contract; "
        f"missing={sorted(missing)!r}, unexpected={sorted(unexpected)!r}"
    )


def _validate_case_contract(case: dict[str, Any]) -> None:
    _assert_field_shape(
        case,
        _CASE_FIELDS,
        optional=_CASE_OPTIONAL_FIELDS,
        label="case",
    )
    expected = case["expected"]
    assert isinstance(expected, dict), "case expected must be an object"
    _assert_field_shape(
        expected,
        _EXPECTED_FIELDS,
        optional=_EXPECTED_OPTIONAL_FIELDS,
        label="expected",
    )

    source = case.get("permanentDenialSource")
    if source is None:
        return
    assert source in _PERMANENT_DENIAL_SOURCES, (
        f"permanentDenialSource is not declared by the contract: {source!r}"
    )
    assert case["initialSnapshot"].get("error") is None, (
        f"permanentDenialSource {source!r} must start without an initial error"
    )
    operations = case["operations"]
    assert operations, f"permanentDenialSource {source!r} has no terminal operation"
    terminal = operations[-1]
    generic_sdk = expected["genericSdk"]
    assert "error" in generic_sdk, (
        f"permanentDenialSource {source!r} must produce a generic SDK error"
    )
    error = generic_sdk["error"]
    assert error.get("causeIdentity") == source, (
        f"permanentDenialSource {source!r} must match expected causeIdentity"
    )

    if source.startswith("error-category-"):
        category = source.removeprefix("error-category-")
        assert terminal.get("kind") == "registry-error", (
            f"permanentDenialSource {source!r} must end in registry-error"
        )
        assert error.get("category") == category, (
            f"permanentDenialSource {source!r} must match expected category"
        )
        return

    if source.startswith("http-"):
        status = int(source.removeprefix("http-"))
        assert terminal.get("kind") == "http-response", (
            f"permanentDenialSource {source!r} must end in http-response"
        )
        assert terminal.get("status") == status, (
            f"permanentDenialSource {source!r} must match terminal HTTP status"
        )
        assert error.get("httpStatus") == status, (
            f"permanentDenialSource {source!r} must match expected httpStatus"
        )
        return

    assert terminal.get("kind") == "canonical-error", (
        f"permanentDenialSource {source!r} must end in canonical-error"
    )
    code_suffix = source.upper().replace("-", "_")
    assert error.get("code", "").endswith(code_suffix), (
        f"permanentDenialSource {source!r} must match expected code suffix "
        f"{code_suffix!r}"
    )


def _validate_corpus_contract(corpus: dict[str, Any]) -> list[dict[str, Any]]:
    _assert_field_shape(corpus, _CORPUS_FIELDS, label="corpus")
    cases = corpus["cases"]
    assert isinstance(cases, list), "corpus cases must be an array"
    assert len(cases) == 35, "corpus must contain exactly 35 cases"
    for case in cases:
        _validate_case_contract(case)
    assert len({case["name"] for case in cases}) == len(cases), (
        "corpus case names must be unique"
    )
    sources = [
        case["permanentDenialSource"]
        for case in cases
        if "permanentDenialSource" in case
    ]
    assert len(sources) == len(_PERMANENT_DENIAL_SOURCES), (
        "permanentDenialSource must classify exactly ten cases"
    )
    assert len(set(sources)) == len(sources), (
        "permanentDenialSource classifications must be one-to-one"
    )
    assert set(sources) == _PERMANENT_DENIAL_SOURCES, (
        "permanentDenialSource classifications must match the exact contract set"
    )
    return cases


CASES = _validate_corpus_contract(CORPUS)


def _observe_error(error: BaseException) -> dict[str, object]:
    result: dict[str, object] = {
        "code": error.code,
        "category": error.category,
        "retryable": bool(error.retryable),
    }
    for source, target in (
        ("status", "httpStatus"),
        ("cause_identity", "causeIdentity"),
        ("request_id", "requestId"),
        ("trace_id", "traceId"),
    ):
        value = getattr(error, source, None)
        if value is not None:
            result[target] = value
    return result


def _wire_error(fields: dict[str, object]) -> IntelligenceError:
    error = IntelligenceError(
        str(fields["causeIdentity"]),
        code=str(fields["code"]),
        category=str(fields["category"]),
        retryable=bool(fields["retryable"]),
        status=fields.get("httpStatus"),
        request_id=fields.get("requestId"),
        trace_id=fields.get("traceId"),
    )
    error.cause_identity = fields["causeIdentity"]
    return error


def _initial_error(case: dict[str, Any]) -> IntelligenceError:
    return _wire_error(case["initialSnapshot"]["error"])


def _failure_for(case: dict[str, Any], operation: dict[str, Any]) -> BaseException:
    kind = operation["kind"]
    if kind == "transient-failure":
        error = IntelligenceUnavailableError("transient-1")
        error.cause_identity = "transient-1"
        return error
    if kind == "integrity-failure":
        error = IntelligenceIntegrityError("integrity-1")
        error.cause_identity = "integrity-1"
        return error
    expected = case["expected"]["genericSdk"]["error"]
    return _wire_error(expected)


def _observed_value(case: dict[str, Any], kind: str) -> int:
    operation = next(op for op in case["operations"] if op["kind"] == kind)
    return int(operation["observed"])


def _result_for(case: dict[str, Any], tmp_path: Path):
    kinds = {operation["kind"] for operation in case["operations"]}
    if "validate-count" in kinds:
        texts = tuple(
            "# Skill\n" for _ in range(_observed_value(case, "validate-count"))
        )
    elif "validate-instruction-bytes" in kinds:
        texts = ("x" * _observed_value(case, "validate-instruction-bytes"),)
    elif "validate-aggregate-bytes" in kinds:
        maximum = CORPUS["fixtures"]["limits"]["maximumInstructionBytes"]
        observed = _observed_value(case, "validate-aggregate-bytes")
        texts = tuple(
            "x" * size
            for size in (maximum, maximum, maximum, maximum, observed - maximum * 4)
        )
    elif "revocation-observed" in kinds or (
        "render" in kinds
        and "bundle-request" not in kinds
        and "cached-preload" not in kinds
    ):
        texts = ()
    else:
        texts = (CORPUS["fixtures"]["instructionText"],)
    roles = ("script",) if "reject-script" in kinds else None
    paths = ("scripts/run.sh",) if "reject-script" in kinds else None
    result = skill_set(
        tmp_path,
        texts=texts,
        roles=roles,
        paths=paths,
        freshness="cached" if "cached-preload" in kinds else "fresh",
        revoked="revocation-observed" in kinds,
        registry_revision=(
            CORPUS["fixtures"]["changedRegistryRevision"]
            if "changed-projection" in kinds
            else CORPUS["fixtures"]["registryRevision"]
        ),
    )
    if "decode-instruction" in kinds:
        (result.skill_descriptors[0].directory / "SKILL.md").write_bytes(b"\xff")
    return result


def _seed(case: dict[str, Any], provider: Any, tmp_path: Path) -> None:
    from copilotkit_intelligence_agent_framework._registry_state import (
        RegistrySnapshot,
        render_verified_skills,
    )

    initial = case["initialSnapshot"]
    if initial["status"] == "cold":
        return
    installed = None
    rendered = ()
    if initial["skillCount"]:
        installed = skill_set(
            tmp_path / "initial",
            texts=(CORPUS["fixtures"]["instructionText"],),
            freshness=initial["source"] if initial["source"] != "none" else "fresh",
            registry_revision=initial["registryRevision"]
            or CORPUS["fixtures"]["registryRevision"],
        )
        rendered = render_verified_skills(installed)
    attempted = initial["lastAttemptAt"]
    if initial["refreshDue"]:
        attempted = -CORPUS["fixtures"]["limits"]["throttleWindowMs"]
    error = _initial_error(case) if initial.get("error") else None
    provider._registry._snapshot = RegistrySnapshot(
        status=initial["status"],
        source=initial["source"],
        installed_skill_set=installed,
        skills=rendered,
        registry_revision=initial["registryRevision"],
        last_attempt_at=None if attempted is None else attempted / 1000,
        last_success_at=0 if installed else None,
        error=error,
    )


async def _pump() -> None:
    for _ in range(12):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_permanent_denial_source_is_consumed_structurally(tmp_path: Path) -> None:
    case = copy.deepcopy(
        next(
            candidate
            for candidate in CASES
            if candidate.get("permanentDenialSource") == "error-category-auth"
        )
    )
    case["permanentDenialSource"] = "error-category-permission"

    with pytest.raises(AssertionError, match="permanentDenialSource"):
        await test_adapter_conformance(case, tmp_path)


@pytest.mark.parametrize(
    ("level", "field", "remove"),
    [
        ("corpus", "schemaVersion", True),
        ("corpus", "unexpected", False),
        ("case", "name", True),
        ("case", "unexpected", False),
        ("expected", "calls", True),
        ("expected", "unexpected", False),
    ],
)
def test_corpus_uses_exact_required_and_allowed_field_shapes(
    level: str, field: str, remove: bool
) -> None:
    corpus = copy.deepcopy(CORPUS)
    target = (
        corpus
        if level == "corpus"
        else (corpus["cases"][0] if level == "case" else corpus["cases"][0]["expected"])
    )
    if remove:
        target.pop(field)
    else:
        target[field] = True

    with pytest.raises(AssertionError, match=f"{level} fields"):
        _validate_corpus_contract(corpus)


@pytest.mark.parametrize(
    ("source", "path", "wrong_value", "message"),
    [
        (
            "error-category-auth",
            ("expected", "genericSdk", "error", "category"),
            "permission",
            "expected category",
        ),
        (
            "http-401",
            ("operations", -1, "status"),
            403,
            "terminal HTTP status",
        ),
        (
            "http-403",
            ("expected", "genericSdk", "error", "httpStatus"),
            401,
            "expected httpStatus",
        ),
        (
            "container-archived",
            ("operations", -1, "kind"),
            "registry-error",
            "canonical-error",
        ),
        (
            "registry-unrecoverable",
            ("expected", "genericSdk", "error", "code"),
            "LEARNING_CONTAINER_ARCHIVED",
            "code suffix",
        ),
        (
            "project-mismatch",
            ("initialSnapshot", "error"),
            {"code": "unexpected"},
            "initial error",
        ),
    ],
)
def test_permanent_denial_sources_reject_mismatched_inputs_and_outcomes(
    source: str, path: tuple[str | int, ...], wrong_value: object, message: str
) -> None:
    corpus = copy.deepcopy(CORPUS)
    case = next(
        candidate
        for candidate in corpus["cases"]
        if candidate.get("permanentDenialSource") == source
    )
    target: Any = case
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = wrong_value

    with pytest.raises(AssertionError, match=message):
        _validate_corpus_contract(corpus)


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
async def test_adapter_conformance(case: dict[str, Any], tmp_path: Path) -> None:
    """Execute fields from initialSnapshot/operations and compare every expected field."""

    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    _validate_case_contract(case)
    assert CORPUS["schemaVersion"] == 1
    assert CORPUS["contractVersion"] == "registry-adapters-v1"
    assert [op["atMs"] for op in case["operations"]] == sorted(
        op["atMs"] for op in case["operations"]
    )

    now_ms = 0
    events: list[dict[str, object]] = []
    record_telemetry = True
    sink_error = RuntimeError("sink-exception-1")

    async def telemetry(name: str, metadata: dict[str, object]) -> None:
        if not record_telemetry:
            return
        normalized = dict(metadata)
        assert normalized.pop("framework") == "microsoft-agent-framework"
        assert normalized.pop("adapterVersion") == "0.1.0"
        normalized.pop("latencyMs", None)
        normalized["framework"] = "fixture"
        events.append({"name": name, "atMs": now_ms, "metadata": normalized})
        if "telemetry-write" in kinds and name == "load.singleflight_joined":
            raise sink_error

    kinds = {operation["kind"] for operation in case["operations"]}
    skills = FakeSkillsClient()
    provider = SkillRegistryContextProvider(
        client(skills),
        CONTAINER_ID,
        refresh_interval=CORPUS["fixtures"]["limits"]["throttleWindowMs"] / 1000,
        clock=lambda: now_ms / 1000,
        telemetry=telemetry,
    )
    _seed(case, provider, tmp_path)

    transitions: list[dict[str, object]] = []
    operations: list[dict[str, object]] = []
    active: list[tuple[str, asyncio.Task[Any]]] = []
    results: list[tuple[str, object]] = []
    thrown: BaseException | None = None
    readiness: dict[str, object] | None = None
    readiness_task: asyncio.Task[Any] | None = None
    close_count = 0
    expected_get = case["expected"]["calls"]["client"]["get"]
    expected_cached = case["expected"]["calls"]["client"]["getCached"]

    def transition(at_ms: int, before: str) -> None:
        after = provider.status
        if before != after:
            transitions.append({"atMs": at_ms, "from": before, "to": after})

    async def start(
        operation: dict[str, Any], method: Any, cached: bool = False
    ) -> None:
        outcomes = skills.cached_outcomes if cached else skills.get_outcomes
        calls = skills.cached_calls if cached else skills.get_calls
        expected = expected_cached if cached else expected_get
        if len(calls) < expected and not outcomes:
            outcomes.append(asyncio.get_running_loop().create_future())
        before = provider.status
        task = asyncio.create_task(method())
        active.append((operation["kind"], task))
        await _pump()
        transition(operation["atMs"], before)

    async def settle(operation: dict[str, Any], *, failure: bool = False) -> None:
        outcomes = (
            skills.cached_outcomes
            if operation["kind"] == "cached-preload"
            else skills.get_outcomes
        )
        pending = next(
            (
                outcome
                for outcome in outcomes
                if isinstance(outcome, asyncio.Future) and not outcome.done()
            ),
            None,
        )
        if pending is None:
            # FakeSkillsClient pops its future before awaiting it; find it in the active task by
            # retaining the last future created on the test client.
            pending = getattr(skills, "_conformance_pending", None)
        if pending is None:
            raise AssertionError("no Registry request is pending")
        before = provider.status
        if failure:
            pending.set_exception(_failure_for(case, operation))
        else:
            pending.set_result(
                _result_for(case, tmp_path / f"result-{operation['atMs']}")
            )
        await _pump()
        current = []
        for name, task in active:
            if task.done():
                try:
                    current.append((name, task.result()))
                except BaseException as error:
                    nonlocal_thrown[0] = error
                    current.append((name, error))
            else:
                current.append((name, task))
        results[:] = current
        transition(operation["atMs"], before)

    # A separate reference keeps popped futures addressable after FakeSkillsClient starts them.
    original_next = skills._next

    async def retaining_next(outcomes: list[Any]) -> Any:
        if outcomes and isinstance(outcomes[0], asyncio.Future):
            skills._conformance_pending = outcomes[0]
        return await original_next(outcomes)

    skills._next = retaining_next
    nonlocal_thrown: list[BaseException | None] = [None]

    success_terminals = {
        "render",
        "not-modified",
        "revocation-observed",
        "validate-count",
        "validate-instruction-bytes",
        "validate-aggregate-bytes",
        "decode-instruction",
        "reject-script",
    }
    failure_terminals = {
        "transient-failure",
        "integrity-failure",
        "denial-response",
        "registry-error",
        "http-response",
        "canonical-error",
    }

    for index, operation in enumerate(case["operations"]):
        operations.append(dict(operation))
        now_ms = operation["atMs"]
        kind = operation["kind"]
        next_kind = (
            case["operations"][index + 1]["kind"]
            if index + 1 < len(case["operations"])
            else None
        )
        if kind in {"load", "load-caller-a", "load-caller-b", "registry-request"}:
            if kind == "load" and next_kind == "throttle-hit":
                now_ms = case["operations"][index + 1]["atMs"]
            await start(operation, provider.load)
        elif kind == "cached-preload":
            await start(operation, provider.preload_cached, cached=True)
        elif kind == "bundle-request" and next_kind is None:
            await settle(operation)
        elif kind == "bundle-request":
            pass
        elif kind in success_terminals:
            await settle(operation)
        elif kind in failure_terminals:
            await settle(operation, failure=True)
        elif kind == "telemetry-write":
            await settle(operation)
        elif kind == "throttle-check":
            before = provider.status
            try:
                await provider.load()
            except BaseException as error:
                thrown = error
            transition(operation["atMs"], before)
        elif kind == "throttle-hit":
            await _pump()
            for name, task in active:
                if task.done():
                    try:
                        results.append((name, task.result()))
                    except BaseException as error:
                        thrown = error
            transition(operation["atMs"], provider.status)
        elif kind == "close":
            before = provider.status
            await provider.aclose()
            if before != "closed":
                close_count += 1
            transition(operation["atMs"], before)
        elif kind == "readiness":
            timeout = 0 if next_kind == "timeout" else 0
            readiness_task = asyncio.create_task(provider.wait_until_ready(timeout))
            if next_kind != "timeout":
                await _pump()
        elif kind == "timeout":
            assert readiness_task is not None
            await _pump()
        elif kind in {
            "projection-request",
            "conditional-projection-request",
            "cache-read",
            "changed-projection",
        }:
            pass
        else:
            raise AssertionError(f"unsupported operation: {operation}")

    settled_active = await asyncio.gather(
        *(task for _, task in active), return_exceptions=True
    )
    if not results:
        results.extend(
            (name, value)
            for (name, _), value in zip(active, settled_active, strict=True)
        )
    if nonlocal_thrown[0] is None:
        nonlocal_thrown[0] = next(
            (value for value in settled_active if isinstance(value, BaseException)),
            None,
        )
    thrown = nonlocal_thrown[0] or thrown
    if readiness_task is None:
        readiness_task = asyncio.create_task(provider.wait_until_ready(0))
    try:
        ready_snapshot = await readiness_task
        readiness = {"result": {"state": ready_snapshot.status}}
    except BaseException as error:
        thrown = thrown or error
        readiness = {"error": _observe_error(error)}

    only_closes = all(operation["kind"] == "close" for operation in case["operations"])
    attempted_load = bool(
        kinds & {"load", "load-caller-a", "registry-request", "cached-preload"}
    )
    if provider.status == "closed" and only_closes:
        generic_sdk: dict[str, object] = {
            "result": {"state": "closed", "closeCount": close_count}
        }
    elif provider.status in {"ready", "revoked"} or (
        provider.status == "stale" and attempted_load
    ):
        generic_sdk = {
            "result": {
                "state": provider.status,
                "freshness": "stale"
                if provider.status == "stale"
                else provider.snapshot.source,
                "registryRevision": provider.snapshot.registry_revision,
                "skillCount": len(provider.snapshot.skills),
                "aggregateByteLength": sum(
                    skill.byte_length for skill in provider.snapshot.skills
                ),
            }
        }
    else:
        error = thrown or provider.snapshot.error
        assert error is not None
        generic_sdk = {"error": _observe_error(error)}

    observed_calls = {
        "client": {
            "projection": len(skills.get_calls),
            "bundle": sum(op["kind"] == "bundle-request" for op in operations),
            "cached": len(skills.cached_calls)
            + sum(op["kind"] == "cache-read" for op in operations),
            "network": len(skills.get_calls)
            + sum(op["kind"] == "bundle-request" for op in operations),
            "get": len(skills.get_calls),
            "getCached": len(skills.cached_calls),
        },
        "routing": {"readiness": 1, "nativeHook": 1},
    }

    context = SessionContext(input_messages=[])
    record_telemetry = False
    try:
        await provider.before_run(
            agent=object(), session=AgentSession(), context=context, state={}
        )
        native_hook = {"proceed": True}
    except BaseException:
        native_hook = {"proceed": False}

    rendered = (
        []
        if provider.status == "stale" and not attempted_load
        else [record.as_native() for record in provider.snapshot.skills]
    )
    singleflight = None
    if "singleflight" in case["expected"]:
        caller_results = [
            value
            for name, value in results
            if name in {"load-caller-a", "load-caller-b"}
        ]
        assert len(caller_results) == 2
        assert caller_results[0] is caller_results[1]
        assert caller_results[0].__cause__ is sink_error
        barrier = next(
            op["barrier"] for op in operations if op["kind"] == "load-caller-a"
        )
        singleflight = {
            "barrier": barrier,
            "registryCalls": len(skills.get_calls),
            "sinkExceptionIdentity": str(sink_error),
            "callers": [
                {
                    "name": name.removeprefix("load-"),
                    "rejectionIdentity": value.cause_identity,
                    "causeIdentity": str(sink_error),
                }
                for name, value in results
                if name in {"load-caller-a", "load-caller-b"}
            ],
        }

    actual = {
        "calls": observed_calls,
        "statusTransitions": transitions,
        "genericSdk": generic_sdk,
        "readiness": readiness,
        "nativeHook": native_hook,
        "telemetryNames": [event["name"] for event in events],
        "renderedRecords": rendered,
        "telemetryRecords": events,
    }
    if singleflight is not None:
        actual["singleflight"] = singleflight

    assert operations == case["operations"]
    assert actual == case["expected"]
