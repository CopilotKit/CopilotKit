from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from pathlib import Path
from typing import Any

import pytest
from copilotkit import (
    IntelligenceAccessDeniedError,
    IntelligenceError,
    IntelligenceIntegrityError,
    IntelligenceUnavailableError,
)
from langchain.agents.middleware import ModelRequest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import SystemMessage

from conftest import (
    CONTAINER_ID,
    FakeClock,
    FakeSkillsClient,
    client,
    declared_contract_fields,
    skill_set,
)


CORPUS_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages/intelligence/conformance/registry-adapters-v1.json"
)
CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
CASES = CORPUS["cases"]
PERMANENT_DENIAL_CASES = tuple(
    case for case in CASES if "permanentDenialSource" in case
)
CONSUMED_CONTRACT_FIELDS = (
    "cases",
    "contractVersion",
    "distribution",
    "fixtures",
    "schemaVersion",
    "sourceCorpus",
    "cases[].expected",
    "cases[].initialSnapshot",
    "cases[].name",
    "cases[].operations",
    "cases[].permanentDenialSource",
    "cases[].expected.calls",
    "cases[].expected.genericSdk",
    "cases[].expected.nativeHook",
    "cases[].expected.readiness",
    "cases[].expected.renderedRecords",
    "cases[].expected.singleflight",
    "cases[].expected.statusTransitions",
    "cases[].expected.telemetryNames",
    "cases[].expected.telemetryRecords",
)


def _assert_contract_structure(corpus: dict[str, Any]) -> None:
    assert declared_contract_fields(corpus) == set(CONSUMED_CONTRACT_FIELDS)
    assert corpus["schemaVersion"] == 1
    assert corpus["contractVersion"] == "registry-adapters-v1"
    assert corpus["distribution"] == {
        "repositoryTestOnly": True,
        "publishedExport": False,
        "runtimeDependency": False,
    }
    assert corpus["sourceCorpus"] == "registry-sdk-v1.json"
    assert isinstance(corpus["fixtures"], dict)
    assert len(corpus["cases"]) == 35

    case_fields = {"name", "initialSnapshot", "operations", "expected"}
    expected_fields = {
        "calls",
        "genericSdk",
        "nativeHook",
        "readiness",
        "renderedRecords",
        "statusTransitions",
        "telemetryNames",
        "telemetryRecords",
    }
    denial_count = 0
    for case in corpus["cases"]:
        assert set(case) in (
            case_fields,
            case_fields | {"permanentDenialSource"},
        )
        assert set(case["expected"]) in (
            expected_fields,
            expected_fields | {"singleflight"},
        )
        denial_count += "permanentDenialSource" in case
    assert denial_count == 10


_assert_contract_structure(CORPUS)


def _error_from(fields: dict[str, object]) -> IntelligenceError:
    error_type = (
        IntelligenceAccessDeniedError
        if fields["code"] == "LEARNING_REGISTRY_DENIED"
        else IntelligenceError
    )
    error = error_type(
        str(fields.get("causeIdentity", fields["code"])),
        code=str(fields["code"]),
        category=str(fields["category"]),
        retryable=bool(fields["retryable"]),
        status=fields.get("httpStatus"),
        request_id=fields.get("requestId"),
        trace_id=fields.get("traceId"),
    )
    error.cause_identity = fields.get("causeIdentity")
    return error


def _observe_error(error: BaseException) -> dict[str, object]:
    observed: dict[str, object] = {
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
            observed[target] = value
    return observed


def _assert_error(error: BaseException, expected: dict[str, object]) -> None:
    assert _observe_error(error) == expected


def _verified_set(
    case: dict[str, Any], tmp_path: Path, label: str, *, initial: bool = False
):
    expected = case["expected"]
    model = (
        case["initialSnapshot"] if initial else expected["genericSdk"].get("result", {})
    )
    records = expected["renderedRecords"]
    operation_kinds = {operation["kind"] for operation in case["operations"]}
    texts = tuple(record["text"] for record in records)
    kwargs: dict[str, Any] = {}
    if "validate-count" in operation_kinds:
        texts = tuple("# Skill\n" for _ in range(129))
    elif "validate-instruction-bytes" in operation_kinds:
        texts = ("x" * 262145,)
    elif "validate-aggregate-bytes" in operation_kinds:
        texts = tuple("x" * size for size in (209715, 209715, 209715, 209715, 209717))
    elif operation_kinds & {"decode-instruction", "reject-script"}:
        texts = ("# Skill\n",)
    elif model.get("skillCount", len(texts)) == 1 and not texts:
        texts = ("# Skill\n",)
    if "reject-script" in operation_kinds:
        kwargs["roles"] = ("script",)

    installed = skill_set(
        tmp_path / label,
        freshness=str(model.get("freshness", model.get("source", "fresh"))),
        revoked=model.get("state") == "revoked",
        texts=texts,
        registry_revision=str(model.get("registryRevision") or "revision-1"),
        corpus_identity=True,
        **kwargs,
    )
    if "decode-instruction" in operation_kinds:
        (installed.skill_descriptors[0].directory / "SKILL.md").write_bytes(b"\xff")
    return installed


def _seed_initial_snapshot(registry, case: dict[str, Any], tmp_path: Path) -> None:
    from copilotkit_intelligence_langgraph._registry_state import (
        RegistrySnapshot,
        _render_prompt,
        render_verified_skills,
    )

    initial = case["initialSnapshot"]
    if initial["status"] == "cold":
        return
    installed = None
    rendered = ()
    if initial["skillCount"]:
        installed = _verified_set(case, tmp_path, "initial", initial=True)
        rendered = render_verified_skills(
            installed,
            maximum_skills=128,
            maximum_skill_bytes=262144,
            maximum_context_bytes=1048576,
        )
    error = _error_from(initial["error"]) if "error" in initial else None
    attempted = initial["lastAttemptAt"]
    if initial["refreshDue"]:
        attempted = -30000
    registry._state._snapshot = RegistrySnapshot(
        status=initial["status"],
        source=initial["source"],
        installed_skill_set=installed,
        rendered_skills=rendered,
        prompt=_render_prompt(rendered),
        registry_revision=initial["registryRevision"],
        last_attempt_at=None if attempted is None else attempted / 1000,
        last_success_at=None if installed is None else 0,
        error=error,
    )


def _operation_outcomes(case: dict[str, Any], tmp_path: Path) -> list[object]:
    expected = case["expected"]
    calls = expected["calls"]["client"]
    count = calls["get"] + calls["getCached"]
    if count == 0:
        return []
    kinds = {operation["kind"] for operation in case["operations"]}
    if count == 2:
        return [
            IntelligenceUnavailableError("transient-1"),
            _verified_set(case, tmp_path, "outcome-2"),
        ]
    if "transient-failure" in kinds:
        return [IntelligenceUnavailableError("transient-1")]
    if "integrity-failure" in kinds:
        return [IntelligenceIntegrityError("integrity-1")]
    generic = expected["genericSdk"]
    adapter_validation = bool(
        kinds
        & {
            "validate-count",
            "validate-instruction-bytes",
            "validate-aggregate-bytes",
            "decode-instruction",
            "reject-script",
        }
    )
    if "error" in generic and not adapter_validation and "telemetry-write" not in kinds:
        return [_error_from(generic["error"])]
    return [_verified_set(case, tmp_path, "outcome-1")]


def _assert_permanent_denial_source(
    case: dict[str, Any], outcomes: list[object]
) -> None:
    source = case.get("permanentDenialSource")
    if source is None:
        return

    initial = case["initialSnapshot"]
    assert initial["status"] == "cold"
    assert "error" not in initial
    expected_error = case["expected"]["genericSdk"]["error"]
    assert len(outcomes) == 1
    outcome = outcomes[0]
    assert isinstance(outcome, IntelligenceError)
    assert source == expected_error["causeIdentity"] == outcome.cause_identity
    assert expected_error["retryable"] is False
    assert case["expected"]["statusTransitions"][-1]["to"] == "denied"

    terminal = case["operations"][-1]
    if source.startswith("error-category-"):
        category = source.removeprefix("error-category-")
        assert terminal["kind"] == "registry-error"
        assert category == expected_error["category"] == outcome.category
    elif source.startswith("http-"):
        status = int(source.removeprefix("http-"))
        assert terminal["kind"] == "http-response"
        assert status == terminal["status"] == expected_error["httpStatus"]
        assert outcome.status == status
    else:
        code_suffix = source.upper().replace("-", "_")
        assert terminal["kind"] == "canonical-error"
        assert expected_error["code"] == outcome.code
        assert expected_error["code"].endswith(code_suffix)


@pytest.mark.parametrize(
    "case",
    PERMANENT_DENIAL_CASES,
    ids=[case["permanentDenialSource"] for case in PERMANENT_DENIAL_CASES],
)
def test_permanent_denial_source_rejects_mismatched_source_mapping(
    case: dict[str, Any], tmp_path: Path
) -> None:
    mutated = deepcopy(case)
    source = mutated["permanentDenialSource"]
    terminal = mutated["operations"][-1]
    if source.startswith("error-category-"):
        terminal["kind"] = "canonical-error"
    elif source.startswith("http-"):
        terminal["status"] = 418
    else:
        mutated["expected"]["genericSdk"]["error"]["code"] = "LEARNING_REGISTRY_DENIED"

    outcomes = _operation_outcomes(mutated, tmp_path)
    with pytest.raises(AssertionError):
        _assert_permanent_denial_source(mutated, outcomes)


async def _pump() -> None:
    for _ in range(12):
        await asyncio.sleep(0)


class _SnapshotState:
    def __init__(self, snapshot, error: BaseException | None) -> None:
        self._snapshot = snapshot
        self._error = error

    async def load(self):
        if self._error is not None:
            raise self._error
        return self._snapshot


def _model_request() -> ModelRequest:
    return ModelRequest(
        model=FakeListChatModel(responses=["ok"]),
        messages=[],
        system_message=SystemMessage(content="base"),
        tools=[],
        state={"messages": []},
        runtime=None,
        model_settings={},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
async def test_adapter_conformance(case: dict[str, Any], tmp_path: Path) -> None:
    """Execute every corpus operation and assert every observable adapter field."""

    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware
    from copilotkit_intelligence_langgraph.middleware import _SkillRegistryMiddleware

    expected = case["expected"]
    operations = case["operations"]
    clock = FakeClock()
    skills = FakeSkillsClient()
    outcomes = _operation_outcomes(case, tmp_path)
    _assert_permanent_denial_source(case, outcomes)
    loop = asyncio.get_running_loop()
    futures = [loop.create_future() for _ in outcomes]
    if expected["calls"]["client"]["getCached"]:
        skills.cached_outcomes.extend(futures)
    else:
        skills.get_outcomes.extend(futures)

    telemetry: list[dict[str, object]] = []
    fail_telemetry_once = "telemetry-write" in {
        operation["kind"] for operation in operations
    }
    sink_failure = RuntimeError("sink-exception-1")

    def emit(name: str, metadata: dict[str, object]) -> None:
        nonlocal fail_telemetry_once
        if (
            fail_telemetry_once
            and name == "status.changed"
            and metadata.get("status") in {"ready", "revoked"}
        ):
            fail_telemetry_once = False
            raise sink_failure
        telemetry.append(
            {"name": name, "atMs": round(clock.seconds * 1000), "metadata": metadata}
        )

    registry = createSkillRegistryMiddleware(
        client(skills), CONTAINER_ID, clock=clock, telemetry=emit
    )
    _seed_initial_snapshot(registry, case, tmp_path)
    previous_status = registry.status
    transitions: list[dict[str, object]] = []
    active: list[asyncio.Task] = []
    settled: list[object] = []
    readiness_result: object | None = None
    readiness_calls = 0
    outcome_index = 0
    close_count = 0

    def observe() -> None:
        nonlocal previous_status
        if registry.status != previous_status:
            transitions.append(
                {
                    "atMs": round(clock.seconds * 1000),
                    "from": previous_status,
                    "to": registry.status,
                }
            )
            previous_status = registry.status

    async def settle_active() -> None:
        if not active:
            return
        settled.extend(await asyncio.gather(*active, return_exceptions=True))
        active.clear()
        observe()

    async def start(coroutine, *, pump: bool = True) -> None:
        active.append(asyncio.create_task(coroutine))
        if pump:
            await _pump()
            observe()
            if all(task.done() for task in active):
                await settle_active()

    async def check_readiness(timeout: float | None = 0) -> object:
        nonlocal readiness_calls
        readiness_calls += 1
        try:
            return await registry.wait_until_ready(timeout)
        except BaseException as error:
            return error

    for index, operation in enumerate(operations):
        kind = operation["kind"]
        assert kind in {
            "load",
            "load-caller-a",
            "load-caller-b",
            "cached-preload",
            "registry-request",
            "throttle-check",
            "throttle-hit",
            "close",
            "readiness",
            "timeout",
            "projection-request",
            "conditional-projection-request",
            "bundle-request",
            "cache-read",
            "render",
            "not-modified",
            "changed-projection",
            "revocation-observed",
            "transient-failure",
            "integrity-failure",
            "denial-response",
            "validate-count",
            "validate-instruction-bytes",
            "validate-aggregate-bytes",
            "decode-instruction",
            "reject-script",
            "telemetry-write",
            "registry-error",
            "http-response",
            "canonical-error",
        }
        clock.seconds = operation["atMs"] / 1000
        next_kind = (
            operations[index + 1]["kind"] if index + 1 < len(operations) else None
        )
        if kind in {"load", "load-caller-a", "load-caller-b", "registry-request"}:
            await start(registry.load(), pump=next_kind != "throttle-hit")
        elif kind == "cached-preload":
            await start(registry.preload_cached())
        elif kind == "throttle-check":
            await start(registry.load())
        elif kind == "throttle-hit":
            await _pump()
            observe()
            await settle_active()
        elif kind == "close":
            before = registry.status
            await registry.aclose()
            if before != "closed":
                close_count += 1
            observe()
        elif kind == "readiness" and next_kind != "timeout":
            readiness_result = await check_readiness()
        elif kind == "timeout":
            readiness_result = await check_readiness(0.001)

        terminal = index == len(operations) - 1 or (
            kind == "transient-failure" and len(outcomes) == 2
        )
        if terminal and outcome_index < len(outcomes):
            future = futures[outcome_index]
            outcome = outcomes[outcome_index]
            outcome_index += 1
            if isinstance(outcome, BaseException):
                future.set_exception(outcome)
            else:
                future.set_result(outcome)
            await _pump()
            await settle_active()

    await settle_active()
    assert outcome_index == len(outcomes)
    assert all(future.done() for future in futures)
    if readiness_result is None:
        readiness_result = await check_readiness()

    expected_readiness = expected["readiness"]
    if "result" in expected_readiness:
        assert not isinstance(readiness_result, BaseException)
        assert readiness_result.status == expected_readiness["result"]["state"]
    else:
        assert isinstance(readiness_result, BaseException)
        _assert_error(readiness_result, expected_readiness["error"])
    assert readiness_calls == expected["calls"]["routing"]["readiness"]

    client_calls = expected["calls"]["client"]
    assert len(skills.get_calls) == client_calls["get"]
    assert len(skills.cached_calls) == client_calls["getCached"]
    kinds = [operation["kind"] for operation in operations]
    observed_generic_calls = {
        "projection": sum(
            kind
            in {
                "projection-request",
                "conditional-projection-request",
                "registry-request",
            }
            for kind in kinds
        ),
        "bundle": kinds.count("bundle-request"),
        "cached": sum(kind in {"cache-read", "cached-preload"} for kind in kinds),
    }
    observed_generic_calls["network"] = (
        observed_generic_calls["projection"] + observed_generic_calls["bundle"]
    )
    for field, value in observed_generic_calls.items():
        assert value == client_calls[field]

    expected_final_status = (
        expected["statusTransitions"][-1]["to"]
        if expected["statusTransitions"]
        else case["initialSnapshot"]["status"]
    )
    assert registry.status == expected_final_status
    generic = expected["genericSdk"]
    if "result" in generic and "freshness" in generic["result"]:
        result = generic["result"]
        if result["freshness"] in {"fresh", "cached"}:
            assert registry.snapshot.source == result["freshness"]
        assert registry.snapshot.registry_revision == result["registryRevision"]
        assert len(registry.snapshot.rendered_skills) == result["skillCount"]
        assert (
            sum(record.byte_length for record in registry.snapshot.rendered_skills)
            == result["aggregateByteLength"]
        )
    elif "error" in generic:
        assert isinstance(readiness_result, BaseException)
        _assert_error(readiness_result, generic["error"])

    assert transitions == expected["statusTransitions"]
    assert [event["name"] for event in telemetry] == expected["telemetryNames"]
    assert len(telemetry) == len(expected["telemetryRecords"])
    for actual, wanted in zip(telemetry, expected["telemetryRecords"], strict=True):
        assert actual["name"] == wanted["name"]
        assert actual["atMs"] == wanted["atMs"]
        actual_metadata = dict(actual["metadata"])
        actual_metadata["framework"] = "fixture"
        for key, value in wanted["metadata"].items():
            assert actual_metadata[key] == value

    actual_records = [
        record.as_native() for record in registry.snapshot.rendered_skills
    ]
    if not (kinds == ["readiness"] and case["initialSnapshot"]["status"] == "stale"):
        assert actual_records == expected["renderedRecords"]
    else:
        assert len(actual_records) == case["initialSnapshot"]["skillCount"]

    native_error = (
        readiness_result if isinstance(readiness_result, BaseException) else None
    )
    native = _SkillRegistryMiddleware(_SnapshotState(registry.snapshot, native_error))
    handler_called = False

    async def handler(request: ModelRequest):
        nonlocal handler_called
        handler_called = True
        return request

    if expected["nativeHook"]["proceed"]:
        forwarded = await native.awrap_model_call(_model_request(), handler)
        assert handler_called
        prompt = forwarded.system_message.text
        cursor = -1
        for record in expected["renderedRecords"]:
            next_cursor = prompt.find(record["text"], cursor + 1)
            assert next_cursor > cursor
            assert record["skillId"] in prompt
            assert record["versionId"] in prompt
            cursor = next_cursor
        native_hook = {"proceed": True}
    else:
        with pytest.raises(BaseException) as native_failure:
            await native.awrap_model_call(_model_request(), handler)
        assert not handler_called
        _assert_error(native_failure.value, expected_readiness["error"])
        native_hook = {"proceed": False}
    assert expected["calls"]["routing"]["nativeHook"] == 1

    if "singleflight" in expected:
        assert len(skills.get_calls) == expected["singleflight"]["registryCalls"]
        assert len(settled) == len(expected["singleflight"]["callers"])
        assert settled[0] is settled[1]
        assert settled[0].__cause__ is sink_failure
        barrier = next(
            operation["barrier"]
            for operation in operations
            if operation["kind"] == "load-caller-a"
        )
        singleflight = {
            "barrier": barrier,
            "registryCalls": len(skills.get_calls),
            "sinkExceptionIdentity": str(sink_failure),
            "callers": [
                {
                    "name": operation["kind"].removeprefix("load-"),
                    "rejectionIdentity": result.cause_identity,
                    "causeIdentity": str(sink_failure),
                }
                for operation, result in zip(operations[:2], settled, strict=True)
            ],
        }
    elif kinds[:2] == ["load-caller-a", "load-caller-b"]:
        assert len(settled) == 2
        assert settled[0] is settled[1]
        singleflight = None
    else:
        singleflight = None

    attempted_load = bool(
        set(kinds) & {"load", "load-caller-a", "registry-request", "cached-preload"}
    )
    if registry.status == "closed" and all(kind == "close" for kind in kinds):
        generic_observation: dict[str, object] = {
            "result": {"state": "closed", "closeCount": close_count}
        }
    elif registry.status in {"ready", "revoked"} or (
        registry.status == "stale" and attempted_load
    ):
        generic_observation = {
            "result": {
                "state": registry.status,
                "freshness": (
                    "stale" if registry.status == "stale" else registry.snapshot.source
                ),
                "registryRevision": registry.snapshot.registry_revision,
                "skillCount": len(registry.snapshot.rendered_skills),
                "aggregateByteLength": sum(
                    record.byte_length for record in registry.snapshot.rendered_skills
                ),
            }
        }
    else:
        error = (
            readiness_result
            if isinstance(readiness_result, BaseException)
            else registry.snapshot.error
        )
        assert isinstance(error, BaseException)
        generic_observation = {"error": _observe_error(error)}

    telemetry_observation = []
    for event in telemetry:
        metadata = dict(event["metadata"])
        assert metadata.pop("framework") == "langgraph-python"
        assert metadata.pop("adapterVersion") == "0.1.0"
        metadata.pop("latencyMs", None)
        metadata["framework"] = "fixture"
        telemetry_observation.append({**event, "metadata": metadata})

    rendered_observation = (
        []
        if kinds == ["readiness"] and case["initialSnapshot"]["status"] == "stale"
        else actual_records
    )
    actual = {
        "calls": {
            "client": {
                **observed_generic_calls,
                "get": len(skills.get_calls),
                "getCached": len(skills.cached_calls),
            },
            "routing": {"readiness": readiness_calls, "nativeHook": 1},
        },
        "statusTransitions": transitions,
        "genericSdk": generic_observation,
        "readiness": (
            {"error": _observe_error(readiness_result)}
            if isinstance(readiness_result, BaseException)
            else {"result": {"state": readiness_result.status}}
        ),
        "nativeHook": native_hook,
        "telemetryNames": [event["name"] for event in telemetry_observation],
        "renderedRecords": rendered_observation,
        "telemetryRecords": telemetry_observation,
    }
    if singleflight is not None:
        actual["singleflight"] = singleflight

    assert actual == expected
