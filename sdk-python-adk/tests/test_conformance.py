from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from copilotkit import (
    IntelligenceAccessDeniedError,
    IntelligenceError,
    IntelligenceIntegrityError,
    IntelligenceUnavailableError,
)

from conftest import CONTAINER_ID, FakeClock, FakeSkillsClient, client, skill_set


CORPUS_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages/intelligence/conformance/registry-adapters-v1.json"
)
CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
CASES = CORPUS["cases"]


def _expected_error(case: dict[str, object]) -> dict[str, object]:
    expected = case["expected"]
    assert isinstance(expected, dict)
    readiness = expected["readiness"]
    assert isinstance(readiness, dict)
    error = readiness["error"]
    assert isinstance(error, dict)
    return error


def _canonical_error(case: dict[str, object]) -> IntelligenceError:
    expected = _expected_error(case)
    error_type = (
        IntelligenceAccessDeniedError if case["name"] == "denial" else IntelligenceError
    )
    return error_type(
        str(case["name"]),
        code=str(expected["code"]),
        category=str(expected["category"]),
        retryable=bool(expected["retryable"]),
        status=expected.get("httpStatus"),
        request_id=expected.get("requestId"),
        trace_id=expected.get("traceId"),
    )


async def _assert_rejection(registry, expected: dict[str, object]) -> BaseException:
    with pytest.raises(BaseException) as raised:
        await registry.load()
    error = raised.value
    assert getattr(error, "code", None) == expected["code"]
    assert getattr(error, "category", None) == expected["category"]
    assert bool(getattr(error, "retryable", False)) == bool(expected["retryable"])
    return error


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
async def test_adapter_conformance(case: dict[str, object], tmp_path) -> None:
    """Exercise every shared Registry case through the real adapter lifecycle."""

    from copilotkit_intelligence_adk import SkillRegistry, SkillToolset

    name = str(case["name"])
    clock = FakeClock()
    skills = FakeSkillsClient()

    validation = {
        "too-many-skills": {"texts": tuple("# Skill\n" for _ in range(129))},
        "skill-md-too-large": {"texts": ("x" * 262145,)},
        "aggregate-too-large": {
            "texts": tuple(chr(97 + index) * 209716 for index in range(5))
        },
        "script-disabled": {"roles": ("script",)},
    }
    if name in validation or name == "invalid-utf8":
        broken = skill_set(tmp_path, **validation.get(name, {}))
        if name == "invalid-utf8":
            (broken.skill_descriptors[0].directory / "SKILL.md").write_bytes(b"\xff")
        skills.get_outcomes.append(broken)
        registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
        await _assert_rejection(registry, _expected_error(case))
        assert registry.status == "denied"
        assert registry.snapshot.skills == ()
        return

    permanent = {
        "denial",
        "error-category-auth-denied",
        "error-category-permission-denied",
        "http-401-denied",
        "http-403-denied",
        "http-404-denied",
        "http-410-denied",
        "container-archived-denied",
        "project-mismatch-denied",
        "container-not-found-denied",
        "registry-unrecoverable-denied",
    }
    if name in permanent or name == "readiness-denied-rejects":
        error_case = case
        if name == "readiness-denied-rejects":
            error_case = next(item for item in CASES if item["name"] == "denial")
        failure = _canonical_error(error_case)
        skills.get_outcomes.append(failure)
        registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
        expected = _expected_error(case)
        error = await _assert_rejection(registry, expected)
        with pytest.raises(BaseException) as readiness:
            await registry.wait_until_ready()
        assert readiness.value is error
        assert registry.status == "denied"
        assert registry.snapshot.skills == ()
        return

    if name in {"transient-stale", "integrity-stale", "readiness-stale-rejects"}:
        transient = (
            IntelligenceIntegrityError("integrity")
            if name == "integrity-stale"
            else IntelligenceUnavailableError("unavailable")
        )
        skills.get_outcomes.extend(
            [skill_set(tmp_path, corpus_identity=True), transient]
        )
        registry = SkillRegistry(
            client(skills), CONTAINER_ID, clock=clock, refresh_interval=0
        )
        original = await registry.load()
        expected = _expected_error(case)
        error = await _assert_rejection(registry, expected)
        assert registry.status == "stale"
        assert registry.snapshot.skills is original.skills
        with pytest.raises(BaseException) as readiness:
            await registry.wait_until_ready()
        assert readiness.value is error
        return

    if name in {
        "close-idempotent",
        "readiness-closed-rejects",
        "load-after-close-rejects",
    }:
        registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
        await registry.aclose()
        await registry.aclose()
        operation = (
            registry.load
            if name == "load-after-close-rejects"
            else registry.wait_until_ready
        )
        with pytest.raises(BaseException) as closed:
            await operation()
        assert closed.value.code == "LEARNING_REGISTRY_CLOSED"
        assert skills.get_calls == []
        return

    if name == "readiness-timeout":
        registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
        with pytest.raises(BaseException) as timeout:
            await registry.wait_until_ready(0.001)
        assert timeout.value.code == "LEARNING_REGISTRY_READINESS_TIMEOUT"
        assert timeout.value.retryable is True
        return

    if name == "telemetry-sink-failure-singleflight":
        sink_error = RuntimeError("sink-exception-1")

        def telemetry(event: str, metadata: dict[str, object]) -> None:
            del metadata
            if event == "status.changed":
                raise sink_error

        pending = asyncio.get_running_loop().create_future()
        skills.get_outcomes.append(pending)
        registry = SkillRegistry(
            client(skills), CONTAINER_ID, clock=clock, telemetry=telemetry
        )
        callers = [asyncio.create_task(registry.load()) for _ in range(2)]
        await asyncio.sleep(0)
        pending.set_result(skill_set(tmp_path, corpus_identity=True))
        errors = await asyncio.gather(*callers, return_exceptions=True)
        assert errors[0] is errors[1]
        assert errors[0].code == "LEARNING_TELEMETRY_SINK_FAILED"
        assert errors[0].__cause__ is sink_error
        assert len(skills.get_calls) == 1
        return

    if name == "concurrent-singleflight":
        pending = asyncio.get_running_loop().create_future()
        skills.get_outcomes.append(pending)
        registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
        callers = [asyncio.create_task(registry.load()) for _ in range(2)]
        await asyncio.sleep(0)
        pending.set_result(skill_set(tmp_path, corpus_identity=True))
        results = await asyncio.gather(*callers)
        assert results[0] is results[1]
        assert len(skills.get_calls) == 1
        return

    if name == "retry-after-failed-throttle-window":
        skills.get_outcomes.extend(
            [
                skill_set(tmp_path, corpus_identity=True),
                IntelligenceUnavailableError("unavailable"),
                skill_set(tmp_path, corpus_identity=True),
            ]
        )
        registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
        await registry.load()
        clock.seconds = 30
        await _assert_rejection(
            registry,
            {
                "code": "LEARNING_REGISTRY_STALE",
                "category": "availability",
                "retryable": True,
            },
        )
        clock.seconds = 59.999
        await _assert_rejection(
            registry,
            {
                "code": "LEARNING_REGISTRY_STALE",
                "category": "availability",
                "retryable": True,
            },
        )
        assert len(skills.get_calls) == 2
        clock.seconds = 60
        assert (await registry.load()).status == "ready"
        assert len(skills.get_calls) == 3
        return

    revoked = name == "revoked"
    empty = name in {"empty", "revoked"}
    outcome = skill_set(
        tmp_path,
        freshness="cached" if name == "explicit-cached-preload" else "fresh",
        revoked=revoked,
        texts=() if empty else ("# Skill\n",),
        corpus_identity=True,
        registry_revision="revision-2" if name == "changed-revision" else "revision-1",
    )
    if name == "explicit-cached-preload":
        skills.cached_outcomes.append(outcome)
    else:
        skills.get_outcomes.append(outcome)
    registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)
    snapshot = (
        await registry.preload_cached()
        if name == "explicit-cached-preload"
        else await registry.load()
    )
    if name == "throttle-hit":
        assert await registry.load() is snapshot
        assert len(skills.get_calls) == 1
    if name == "readiness-ready":
        assert await registry.wait_until_ready() is snapshot

    expected = case["expected"]
    assert isinstance(expected, dict)
    assert [record.as_native() for record in snapshot.skills] == expected[
        "renderedRecords"
    ]
    assert snapshot.status == ("revoked" if revoked else "ready")
    tools = await SkillToolset(registry).get_tools()
    assert len(tools) == len(snapshot.skills)
