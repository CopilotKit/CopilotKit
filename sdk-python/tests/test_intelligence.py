import asyncio
import base64
import hashlib
import io
import json
import stat
import threading
import time
import unicodedata
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest

from copilotkit import (
    AsyncCopilotKitIntelligence as ExportedAsyncCopilotKitIntelligence,
    CopilotKitIntelligence as ExportedCopilotKitIntelligence,
)
from copilotkit.intelligence import (
    AsyncCopilotKitIntelligence,
    CopilotKitIntelligence,
    IntelligenceAccessDeniedError,
    IntelligenceCacheMissError,
    IntelligenceIntegrityError,
    IntelligenceRequest,
    IntelligenceResponse,
    IntelligenceUnavailableError,
)


def test_clients_are_exported_from_the_package_root():
    assert ExportedCopilotKitIntelligence is CopilotKitIntelligence
    assert ExportedAsyncCopilotKitIntelligence is AsyncCopilotKitIntelligence


def bundle(files=None, *, symlink=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, contents in (files or {"root/SKILL.md": "# Skill"}).items():
            archive.writestr(name, contents)
        if symlink:
            info = zipfile.ZipInfo(symlink)
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "root/SKILL.md")
    return output.getvalue()


def projection(entries, *, container="lesson", revision="rev-1", revoked=False):
    projected = []
    for position, (skill_id, version, archive) in enumerate(entries):
        digest = hashlib.sha256(archive).hexdigest()
        projected.append(
            {
                "skillId": skill_id,
                "version": version,
                "position": position,
                "manifest": {"skillId": skill_id, "version": version},
                "bundle": {
                    "data": base64.b64encode(archive).decode(),
                    "sha256": digest,
                    "length": len(archive),
                },
            }
        )
    canonical = json.dumps(
        {"entries": projected, "revoked": revoked},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return {
        "learningContainerId": container,
        "registryRevision": revision,
        "skillSetHash": hashlib.sha256(canonical).hexdigest(),
        "entries": projected,
        "revoked": revoked,
    }


class QueueTransport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.lock = threading.Lock()

    def __call__(self, request: IntelligenceRequest):
        with self.lock:
            self.requests.append(request)
            response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def response(payload, status=200, headers=None):
    return IntelligenceResponse(
        status=status,
        headers=headers or {},
        body=json.dumps(payload).encode() if payload is not None else b"",
    )


def client(tmp_path, transport, **kwargs):
    return CopilotKitIntelligence(
        api_key="secret",
        project_namespace="acme/course",
        base_url="https://registry.example",
        cache_dir=tmp_path,
        transport=transport,
        **kwargs,
    )


def test_sync_get_authenticates_projects_and_materializes_ordered_skills(tmp_path):
    payload = projection([("intro", "1", bundle()), ("quiz", "2", bundle())])
    transport = QueueTransport(response(payload, headers={"ETag": '"rev-1"'}))

    result = client(tmp_path, transport).skills.get("lesson")

    assert transport.requests[0].url == (
        "https://registry.example/api/learning-containers/lesson/skills"
    )
    assert transport.requests[0].headers["Authorization"] == "Bearer secret"
    assert (
        transport.requests[0].headers["X-CopilotKit-Project-Namespace"] == "acme/course"
    )
    assert [skill.skill_id for skill in result.skills] == ["intro", "quiz"]
    assert [skill.position for skill in result.skills] == [0, 1]
    assert result.freshness == "fresh"
    assert (result.path / "skills/000000-intro/root/SKILL.md").is_file()
    assert (result.path / "skills/000001-quiz/root/SKILL.md").is_file()
    namespace = hashlib.sha256(b"acme/course").hexdigest()
    assert (
        result.path
        == tmp_path / "v1" / namespace / "lesson" / "sets" / payload["skillSetHash"]
    )
    assert json.loads((result.path / ".copilotkit-skill-set.json").read_text())[
        "entries"
    ]
    assert (
        json.loads(
            (result.path.parent.parent / ".copilotkit-current.json").read_text()
        )["skillSetHash"]
        == payload["skillSetHash"]
    )


@pytest.mark.asyncio
async def test_async_get_has_transport_parity_and_does_not_block_loop(tmp_path):
    payload = projection([("intro", "1", bundle())])

    def slow_transport(request):
        time.sleep(0.08)
        return response(payload)

    sdk = AsyncCopilotKitIntelligence(
        api_key="secret",
        project_namespace="acme/course",
        cache_dir=tmp_path,
        transport=slow_transport,
    )
    ticks = 0

    async def ticker():
        nonlocal ticks
        while ticks < 3:
            await asyncio.sleep(0.01)
            ticks += 1

    result, _ = await asyncio.gather(sdk.skills.get("lesson"), ticker())
    assert ticks == 3
    assert result.skills[0].skill_id == "intro"


@pytest.mark.asyncio
async def test_async_client_accepts_an_async_authenticated_transport(tmp_path):
    payload = projection([("intro", "1", bundle())])
    requests = []

    async def async_transport(request):
        requests.append(request)
        await asyncio.sleep(0)
        return response(payload)

    sdk = AsyncCopilotKitIntelligence(
        api_key="secret",
        project_namespace="acme/course",
        cache_dir=tmp_path,
        transport=async_transport,
        skills_path="/custom/{learning_container_id}",
    )

    result = await sdk.skills.get("lesson")
    assert result.skills[0].skill_id == "intro"
    assert requests[0].url.endswith("/custom/lesson")
    assert requests[0].headers["Authorization"] == "Bearer secret"
    cached = await sdk.skills.get_cached("lesson")
    assert cached.path == result.path
    assert cached.freshness == "cached"


def test_conditional_304_requires_complete_verified_cache(tmp_path):
    payload = projection([("intro", "1", bundle())])
    first = QueueTransport(response(payload))
    sdk = client(tmp_path, first)
    original = sdk.skills.get("lesson")

    second = QueueTransport(IntelligenceResponse(304, {}, b""))
    result = client(tmp_path, second).skills.get("lesson")
    assert second.requests[0].headers["If-None-Match"] == '"rev-1"'
    assert result.path == original.path
    assert result.freshness == "cached"


def test_corrupt_cache_followed_by_304_forces_unconditional_refetch(tmp_path):
    payload = projection([("intro", "1", bundle())])
    sdk = client(tmp_path, QueueTransport(response(payload)))
    cached = sdk.skills.get("lesson")
    (cached.path / "skills/000000-intro/root/SKILL.md").write_text("corrupt")
    transport = QueueTransport(IntelligenceResponse(304, {}, b""), response(payload))

    repaired = client(tmp_path, transport).skills.get("lesson")
    assert "If-None-Match" in transport.requests[0].headers
    assert "If-None-Match" not in transport.requests[1].headers
    assert (
        repaired.path / "skills/000000-intro/root/SKILL.md"
    ).read_text() == "# Skill"


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, IntelligenceAccessDeniedError), (403, IntelligenceAccessDeniedError)],
)
def test_denials_raise_canonical_errors_and_block_old_cache(tmp_path, status, error):
    payload = projection([("intro", "1", bundle())])
    client(tmp_path, QueueTransport(response(payload))).skills.get("lesson")
    denied = client(
        tmp_path, QueueTransport(response({"code": "denied"}, status=status))
    )
    with pytest.raises(error):
        denied.skills.get("lesson")
    with pytest.raises(IntelligenceCacheMissError):
        denied.skills.get_cached("lesson")


def test_transient_get_never_falls_back_but_cached_access_is_explicit(tmp_path):
    payload = projection([("intro", "1", bundle())])
    client(tmp_path, QueueTransport(response(payload))).skills.get("lesson")
    failing = client(tmp_path, QueueTransport(OSError("offline")))
    with pytest.raises(IntelligenceUnavailableError):
        failing.skills.get("lesson")
    assert failing.skills.get_cached("lesson").freshness == "cached"


def test_empty_and_revoked_sets_are_valid_and_replace_current(tmp_path):
    empty = projection([], revision="rev-empty")
    empty_result = client(tmp_path, QueueTransport(response(empty))).skills.get(
        "lesson"
    )
    assert empty_result.skills == ()
    revoked = projection([], revision="rev-revoked", revoked=True)
    revoked_result = client(tmp_path, QueueTransport(response(revoked))).skills.get(
        "lesson"
    )
    assert revoked_result.skills == ()
    assert revoked_result.revoked is True
    assert (
        client(tmp_path, QueueTransport()).skills.get_cached("lesson").revoked is True
    )


def test_registry_revision_is_excluded_from_shared_set_cache_key(tmp_path):
    archive = bundle()
    first = projection([("intro", "1", archive)], revision="rev-1")
    second = projection([("intro", "1", archive)], revision="rev-2")
    sdk = client(tmp_path, QueueTransport(response(first), response(second)))

    first_result = sdk.skills.get("lesson")
    second_result = sdk.skills.get("lesson")

    assert first_result.path == second_result.path
    assert second_result.registry_revision == "rev-2"
    assert sdk.skills.get_cached("lesson").registry_revision == "rev-2"


@pytest.mark.parametrize(
    "bad_files",
    [
        {"../SKILL.md": "x"},
        {"/root/SKILL.md": "x"},
        {"root\\SKILL.md": "x"},
        {"a/SKILL.md": "x", "b/file": "x"},
        {"root/SKILL.md": "x", "root/readme": "x", "root/README": "x"},
        {
            "root/SKILL.md": "x",
            "root/" + unicodedata.normalize("NFD", "café"): "x",
            "root/café": "x",
        },
    ],
)
def test_zip_path_root_case_and_unicode_violations_fail_loudly(tmp_path, bad_files):
    with pytest.raises(IntelligenceIntegrityError):
        transport = QueueTransport(
            response(projection([("bad", "1", bundle(bad_files))]))
        )
        client(tmp_path, transport).skills.get("lesson")


def test_zip_links_missing_skill_md_and_archive_bounds_are_rejected(tmp_path):
    cases = [
        bundle({"root/file.txt": "x"}),
        bundle({"root/SKILL.md": "x"}, symlink="root/link"),
        bundle({"root/SKILL.md": "x", **{f"root/{n}": "x" for n in range(5)}}),
        bundle({"root/SKILL.md": "x" * 64}),
    ]
    for archive in cases:
        with pytest.raises(IntelligenceIntegrityError):
            client(
                tmp_path,
                QueueTransport(response(projection([("bad", "1", archive)]))),
                max_archive_entries=4,
                max_uncompressed_bytes=32,
            ).skills.get("lesson")


@pytest.mark.parametrize(
    "mutation", ["hash", "length", "order", "manifest", "projection"]
)
def test_hash_length_order_manifest_and_projection_are_verified(tmp_path, mutation):
    payload = projection([("intro", "1", bundle()), ("quiz", "1", bundle())])
    if mutation == "hash":
        payload["entries"][0]["bundle"]["sha256"] = "0" * 64
    elif mutation == "length":
        payload["entries"][0]["bundle"]["length"] += 1
    elif mutation == "order":
        payload["entries"][1]["position"] = 0
    elif mutation == "manifest":
        payload["entries"][0]["manifest"]["skillId"] = "other"
    else:
        payload["skillSetHash"] = "f" * 64
    with pytest.raises(IntelligenceIntegrityError):
        client(tmp_path, QueueTransport(response(payload))).skills.get("lesson")


def test_loose_missing_or_extra_bundle_objects_are_rejected(tmp_path):
    missing = projection([("intro", "1", bundle())])
    del missing["entries"][0]["bundle"]
    extra = projection([("intro", "1", bundle())])
    extra["entries"][0]["unexpectedBundle"] = {"data": "AA=="}
    for payload in (missing, extra):
        with pytest.raises(IntelligenceIntegrityError):
            client(tmp_path, QueueTransport(response(payload))).skills.get("lesson")


def test_atomic_race_reuses_fully_validated_winner(tmp_path):
    payload = projection([("intro", "1", bundle())])
    transport = QueueTransport(response(payload), response(payload))
    sdk = client(tmp_path, transport)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: sdk.skills.get("lesson"), range(2)))
    assert results[0].path == results[1].path
    assert not list(results[0].path.parent.glob("*.staging-*"))
    assert (results[0].path / "skills/000000-intro/root/SKILL.md").is_file()
