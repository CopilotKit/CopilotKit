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
from pathlib import Path

import pytest

from copilotkit import (
    AsyncCopilotKitIntelligence as ExportedAsyncCopilotKitIntelligence,
    CopilotKitIntelligence as ExportedCopilotKitIntelligence,
)

CONTAINER = "55555555-5555-4555-8555-555555555555"
INTRO = "99999999-9999-4999-8999-999999999999"
QUIZ = "88888888-8888-4888-8888-888888888888"
BAD = "77777777-7777-4777-8777-777777777777"
VERSION_ONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
VERSION_TWO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
from copilotkit.intelligence import (
    AsyncCopilotKitIntelligence,
    CopilotKitIntelligence,
    IntelligenceAccessDeniedError,
    IntelligenceCacheMissError,
    IntelligenceError,
    IntelligenceIntegrityError,
    IntelligenceRequest,
    IntelligenceResponse,
    IntelligenceUnavailableError,
)


def golden_registry_fixture():
    path = (
        Path(__file__).parents[2]
        / "packages/intelligence/conformance/registry-sdk-v1.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def golden_client(tmp_path, transport):
    golden = golden_registry_fixture()
    return CopilotKitIntelligence(
        api_key="secret-token",
        project_namespace=golden["identity"]["projectNamespace"],
        base_url=golden["identity"]["baseUrl"],
        cache_dir=tmp_path,
        transport=transport,
    )


def test_clients_are_exported_from_the_package_root():
    assert ExportedCopilotKitIntelligence is CopilotKitIntelligence
    assert ExportedAsyncCopilotKitIntelligence is AsyncCopilotKitIntelligence


def test_shared_golden_projection_uses_canonical_v1_http_contract(tmp_path):
    golden = golden_registry_fixture()
    archive = base64.b64decode(golden["bundle"]["base64"], validate=True)
    transport = QueueTransport(
        response(golden["projection"]), IntelligenceResponse(200, {}, archive)
    )

    result = golden_client(tmp_path, transport).skills.get(
        golden["identity"]["learningContainerId"]
    )

    assert result.freshness == golden["expectations"]["initialFreshness"]
    assert transport.requests[0].url == (
        golden["identity"]["baseUrl"] + golden["http"]["projectionPath"]
    )
    assert (
        transport.requests[0].headers["Authorization"]
        == golden["http"]["authorization"]
    )
    assert (result.skills[0].path / golden["bundle"]["filePath"]).read_text() == (
        golden["bundle"]["fileContents"]
    )


def test_noncanonical_container_id_fails_before_python_transport(tmp_path):
    transport = QueueTransport(response({}))

    with pytest.raises(IntelligenceIntegrityError) as raised:
        golden_client(tmp_path, transport).skills.get("not-a-uuid")

    assert raised.value.code == "LEARNING_REGISTRY_UNRECOVERABLE"
    assert raised.value.category == "validation"
    assert transport.requests == []


def test_canonical_conflict_preserves_cache_and_error_metadata(tmp_path):
    golden = golden_registry_fixture()
    archive = base64.b64decode(golden["bundle"]["base64"], validate=True)
    online = QueueTransport(
        response(golden["projection"]), IntelligenceResponse(200, {}, archive)
    )
    sdk = golden_client(tmp_path, online)
    sdk.skills.get(golden["identity"]["learningContainerId"])
    conflict = golden["errors"]["canonicalConflict"]
    denied = golden_client(
        tmp_path,
        QueueTransport(response(conflict["body"], status=conflict["status"])),
    )

    with pytest.raises(IntelligenceError) as raised:
        denied.skills.get(golden["identity"]["learningContainerId"])

    assert raised.value.code == conflict["body"]["error"]["code"]
    assert raised.value.category == conflict["body"]["error"]["category"]
    assert raised.value.retryable is False
    assert raised.value.request_id == conflict["body"]["requestId"]
    assert raised.value.trace_id == conflict["body"]["traceId"]
    assert (
        denied.skills.get_cached(golden["identity"]["learningContainerId"]).freshness
        == golden["expectations"]["explicitCacheFreshness"]
    )


def test_shared_golden_etag_304_is_fresh_only_after_cache_verification(tmp_path):
    golden = golden_registry_fixture()
    archive = base64.b64decode(golden["bundle"]["base64"], validate=True)
    golden_client(
        tmp_path,
        QueueTransport(
            response(golden["projection"]), IntelligenceResponse(200, {}, archive)
        ),
    ).skills.get(golden["identity"]["learningContainerId"])
    transport = QueueTransport(IntelligenceResponse(304, {}, b""))

    result = golden_client(tmp_path, transport).skills.get(
        golden["identity"]["learningContainerId"]
    )

    assert result.freshness == golden["expectations"]["validated304Freshness"]
    assert (
        transport.requests[0].headers["If-None-Match"] == golden["http"]["ifNoneMatch"]
    )


def test_shared_golden_denial_invalidates_verified_cache(tmp_path):
    golden = golden_registry_fixture()
    archive = base64.b64decode(golden["bundle"]["base64"], validate=True)
    golden_client(
        tmp_path,
        QueueTransport(
            response(golden["projection"]), IntelligenceResponse(200, {}, archive)
        ),
    ).skills.get(golden["identity"]["learningContainerId"])
    denial = golden["errors"]["canonicalDenial"]
    denied = golden_client(
        tmp_path, QueueTransport(response(denial["body"], status=denial["status"]))
    )

    with pytest.raises(IntelligenceError) as raised:
        denied.skills.get(golden["identity"]["learningContainerId"])

    assert raised.value.code == denial["body"]["error"]["code"]
    assert raised.value.request_id == denial["body"]["requestId"]
    with pytest.raises(IntelligenceCacheMissError):
        denied.skills.get_cached(golden["identity"]["learningContainerId"])


@pytest.mark.parametrize("scenario_name", ["unknownCode", "malformed"])
def test_shared_golden_noncanonical_errors_fail_loudly(tmp_path, scenario_name):
    golden = golden_registry_fixture()
    scenario = golden["errors"][scenario_name]
    sdk = golden_client(
        tmp_path,
        QueueTransport(response(scenario["body"], status=scenario["status"])),
    )

    with pytest.raises(IntelligenceError) as raised:
        sdk.skills.get(golden["identity"]["learningContainerId"])

    assert raised.value.code == golden["expectations"]["nonCanonicalErrorCode"]
    assert raised.value.category == "dependency"


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


def projection(entries, *, container=CONTAINER, revision="rev-1", revoked=False):
    projected = []
    for position, (skill_id, version_id, archive) in enumerate(entries):
        digest = hashlib.sha256(archive).hexdigest()
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            manifest_files = []
            for member in zipped.infolist():
                if member.is_dir():
                    continue
                contents = zipped.read(member)
                relative = member.filename.partition("/")[2] or member.filename
                manifest_files.append(
                    {
                        "path": relative,
                        "role": (
                            "instructions" if relative == "SKILL.md" else "resource"
                        ),
                        "mediaType": "text/markdown",
                        "byteLength": len(contents),
                        "rawSha256": hashlib.sha256(contents).hexdigest(),
                    }
                )
        manifest_without_hash = {
            "manifestVersion": 1,
            "agentSkillsProfile": "agentskills:v1",
            "files": manifest_files,
            "bundleSha256": digest,
            "bundleByteLength": len(archive),
            "provenance": {},
        }
        manifest = {
            **manifest_without_hash,
            "manifestSha256": hashlib.sha256(
                json.dumps(
                    manifest_without_hash,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest(),
        }
        projected.append(
            {
                "skillId": skill_id,
                "versionId": version_id,
                "position": position,
                "name": f"Skill {position}",
                "description": None,
                "bundleLocator": {
                    "schemaVersion": 1,
                    "backendId": "primary",
                    "provider": "awsS3",
                    "resource": "skill-bundles",
                    "key": f"objects/{skill_id}.zip",
                    "providerVersion": None,
                    "etag": None,
                    "applicationSha256": digest,
                    "providerChecksum": None,
                    "byteLength": len(archive),
                    "contentType": "application/zip",
                },
                "bundleSha256": digest,
                "manifestSha256": manifest["manifestSha256"],
                "bundleByteLength": len(archive),
                "approvalMethod": "manual",
                "manifest": manifest,
                "downloadUrl": f"/bundles/{skill_id}/{version_id}",
                "testBundleBase64": base64.b64encode(archive).decode(),
            }
        )
    return {
        "schemaVersion": 1,
        "learningContainerId": container,
        "registryRevision": revision,
        "skillSetHash": hashlib.sha256(
            b"".join(archive for _, _, archive in entries)
            + (b"revoked" if revoked else b"active")
        ).hexdigest(),
        "etag": revision,
        "entries": projected,
        "publishedAt": "2026-07-16T18:00:00.000Z",
        "revoked": revoked,
    }


class QueueTransport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.lock = threading.Lock()
        self.bundles = {}

    def __call__(self, request: IntelligenceRequest):
        with self.lock:
            self.requests.append(request)
            if "/bundles/" in request.url and request.url in self.bundles:
                return IntelligenceResponse(200, {}, self.bundles[request.url])
            response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        if isinstance(response, IntelligenceResponse) and response.status == 200:
            try:
                payload = json.loads(response.body)
            except (UnicodeError, json.JSONDecodeError):
                payload = None
            if isinstance(payload, dict) and isinstance(payload.get("entries"), list):
                for entry in payload["entries"]:
                    if isinstance(entry, dict) and "testBundleBase64" in entry:
                        self.bundles[
                            "https://registry.example" + entry["downloadUrl"]
                        ] = base64.b64decode(entry["testBundleBase64"], validate=True)
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
    payload = projection(
        [(INTRO, VERSION_ONE, bundle()), (QUIZ, VERSION_TWO, bundle())]
    )
    transport = QueueTransport(response(payload, headers={"ETag": '"rev-1"'}))

    result = client(tmp_path, transport).skills.get(CONTAINER)

    assert transport.requests[0].url == (
        f"https://registry.example/v1/learning-containers/{CONTAINER}/skills"
    )
    assert transport.requests[0].headers["Authorization"] == "Bearer secret"
    assert (
        transport.requests[0].headers["X-CopilotKit-Project-Namespace"] == "acme/course"
    )
    assert [skill.skill_id for skill in result.skills] == [INTRO, QUIZ]
    assert [skill.position for skill in result.skills] == [0, 1]
    assert result.freshness == "fresh"
    assert (result.path / f"skills/000000-{INTRO}/root/SKILL.md").is_file()
    assert (result.path / f"skills/000001-{QUIZ}/root/SKILL.md").is_file()
    namespace = hashlib.sha256(b"acme/course").hexdigest()
    assert (
        result.path
        == tmp_path / "v1" / namespace / CONTAINER / "sets" / payload["skillSetHash"]
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
    archive = bundle()
    payload = projection([(INTRO, VERSION_ONE, archive)])

    def slow_transport(request):
        time.sleep(0.08)
        return (
            IntelligenceResponse(200, {}, archive)
            if "/bundles/" in request.url
            else response(payload)
        )

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

    result, _ = await asyncio.gather(sdk.skills.get(CONTAINER), ticker())
    assert ticks == 3
    assert result.skills[0].skill_id == INTRO


@pytest.mark.asyncio
async def test_async_client_accepts_an_async_authenticated_transport(tmp_path):
    archive = bundle()
    payload = projection([(INTRO, VERSION_ONE, archive)])
    requests = []

    async def async_transport(request):
        requests.append(request)
        await asyncio.sleep(0)
        return (
            IntelligenceResponse(200, {}, archive)
            if "/bundles/" in request.url
            else response(payload)
        )

    sdk = AsyncCopilotKitIntelligence(
        api_key="secret",
        project_namespace="acme/course",
        cache_dir=tmp_path,
        transport=async_transport,
        skills_path="/custom/{learning_container_id}",
    )

    result = await sdk.skills.get(CONTAINER)
    assert result.skills[0].skill_id == INTRO
    assert requests[0].url.endswith(f"/custom/{CONTAINER}")
    assert requests[0].headers["Authorization"] == "Bearer secret"
    cached = await sdk.skills.get_cached(CONTAINER)
    assert cached.path == result.path
    assert cached.freshness == "cached"


def test_conditional_304_requires_complete_verified_cache(tmp_path):
    payload = projection([(INTRO, VERSION_ONE, bundle())])
    first = QueueTransport(response(payload))
    sdk = client(tmp_path, first)
    original = sdk.skills.get(CONTAINER)

    second = QueueTransport(IntelligenceResponse(304, {}, b""))
    result = client(tmp_path, second).skills.get(CONTAINER)
    assert second.requests[0].headers["If-None-Match"] == "rev-1"
    assert result.path == original.path
    assert result.freshness == "fresh"


def test_corrupt_cache_followed_by_304_forces_unconditional_refetch(tmp_path):
    payload = projection([(INTRO, VERSION_ONE, bundle())])
    sdk = client(tmp_path, QueueTransport(response(payload)))
    cached = sdk.skills.get(CONTAINER)
    (cached.path / f"skills/000000-{INTRO}/root/SKILL.md").write_text("corrupt")
    transport = QueueTransport(IntelligenceResponse(304, {}, b""), response(payload))

    repaired = client(tmp_path, transport).skills.get(CONTAINER)
    assert "If-None-Match" in transport.requests[0].headers
    assert "If-None-Match" not in transport.requests[1].headers
    assert (
        repaired.path / f"skills/000000-{INTRO}/root/SKILL.md"
    ).read_text() == "# Skill"


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, IntelligenceAccessDeniedError), (403, IntelligenceAccessDeniedError)],
)
def test_denials_raise_canonical_errors_and_block_old_cache(tmp_path, status, error):
    payload = projection([(INTRO, VERSION_ONE, bundle())])
    client(tmp_path, QueueTransport(response(payload))).skills.get(CONTAINER)
    canonical = golden_registry_fixture()["errors"]["canonicalDenial"]["body"]
    denied = client(tmp_path, QueueTransport(response(canonical, status=status)))
    with pytest.raises(error):
        denied.skills.get(CONTAINER)
    with pytest.raises(IntelligenceCacheMissError):
        denied.skills.get_cached(CONTAINER)


def test_transient_get_never_falls_back_but_cached_access_is_explicit(tmp_path):
    payload = projection([(INTRO, VERSION_ONE, bundle())])
    client(tmp_path, QueueTransport(response(payload))).skills.get(CONTAINER)
    failing = client(tmp_path, QueueTransport(OSError("offline")))
    with pytest.raises(IntelligenceUnavailableError):
        failing.skills.get(CONTAINER)
    assert failing.skills.get_cached(CONTAINER).freshness == "cached"


def test_malformed_success_does_not_invalidate_previous_verified_cache(tmp_path):
    valid = projection([(INTRO, VERSION_ONE, bundle())])
    client(tmp_path, QueueTransport(response(valid))).skills.get(CONTAINER)
    malformed = projection([(INTRO, VERSION_ONE, bundle())])
    malformed["skillSetHash"] = "F" * 64
    sdk = client(tmp_path, QueueTransport(response(malformed)))

    with pytest.raises(IntelligenceIntegrityError):
        sdk.skills.get(CONTAINER)

    assert sdk.skills.get_cached(CONTAINER).freshness == "cached"


def test_empty_and_revoked_sets_are_valid_and_replace_current(tmp_path):
    empty = projection([], revision="rev-empty")
    empty_result = client(tmp_path, QueueTransport(response(empty))).skills.get(
        CONTAINER
    )
    assert empty_result.skills == ()
    revoked = projection([], revision="rev-revoked", revoked=True)
    revoked_result = client(tmp_path, QueueTransport(response(revoked))).skills.get(
        CONTAINER
    )
    assert revoked_result.skills == ()
    assert revoked_result.revoked is True
    assert (
        client(tmp_path, QueueTransport()).skills.get_cached(CONTAINER).revoked is True
    )


def test_registry_revision_is_excluded_from_shared_set_cache_key(tmp_path):
    archive = bundle()
    first = projection([(INTRO, VERSION_ONE, archive)], revision="rev-1")
    second = projection([(INTRO, VERSION_ONE, archive)], revision="rev-2")
    sdk = client(tmp_path, QueueTransport(response(first), response(second)))

    first_result = sdk.skills.get(CONTAINER)
    second_result = sdk.skills.get(CONTAINER)

    assert first_result.path == second_result.path
    assert second_result.registry_revision == "rev-2"
    assert sdk.skills.get_cached(CONTAINER).registry_revision == "rev-2"


def test_reused_set_hash_must_match_immutable_projected_skill_content(tmp_path):
    archive = bundle()
    first = projection([(INTRO, VERSION_ONE, archive)], revision="rev-1")
    second = projection([(INTRO, VERSION_TWO, archive)], revision="rev-2")
    second["skillSetHash"] = first["skillSetHash"]
    sdk = client(tmp_path, QueueTransport(response(first), response(second)))

    sdk.skills.get(CONTAINER)
    replaced = sdk.skills.get(CONTAINER)

    assert replaced.skills[0].version == VERSION_TWO


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
            response(projection([(BAD, VERSION_ONE, bundle(bad_files))]))
        )
        client(tmp_path, transport).skills.get(CONTAINER)


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
                QueueTransport(response(projection([(BAD, VERSION_ONE, archive)]))),
                max_archive_entries=4,
                max_uncompressed_bytes=32,
            ).skills.get(CONTAINER)


@pytest.mark.parametrize(
    "mutation", ["hash", "length", "order", "manifest", "uppercase-hash"]
)
def test_hash_length_order_manifest_and_projection_are_verified(tmp_path, mutation):
    payload = projection(
        [(INTRO, VERSION_ONE, bundle()), (QUIZ, VERSION_ONE, bundle())]
    )
    if mutation == "hash":
        payload["entries"][0]["bundleSha256"] = "0" * 64
    elif mutation == "length":
        payload["entries"][0]["bundleByteLength"] += 1
    elif mutation == "order":
        payload["entries"][1]["position"] = 0
    elif mutation == "manifest":
        payload["entries"][0]["manifest"]["files"][0]["rawSha256"] = "0" * 64
    else:
        payload["skillSetHash"] = "F" * 64
    with pytest.raises(IntelligenceIntegrityError):
        client(tmp_path, QueueTransport(response(payload))).skills.get(CONTAINER)


def test_missing_canonical_bundle_locator_and_legacy_wire_aliases_are_rejected(
    tmp_path,
):
    missing = projection([(INTRO, VERSION_ONE, bundle())])
    del missing["entries"][0]["bundleLocator"]
    legacy = projection([(INTRO, VERSION_ONE, bundle())])
    entry = legacy["entries"][0]
    entry["version"] = entry.pop("versionId")
    entry["bundle"] = {"data": entry.pop("testBundleBase64")}
    for payload in (missing, legacy):
        with pytest.raises(IntelligenceIntegrityError):
            client(tmp_path, QueueTransport(response(payload))).skills.get(CONTAINER)


def test_atomic_race_reuses_fully_validated_winner(tmp_path):
    payload = projection([(INTRO, VERSION_ONE, bundle())])
    transport = QueueTransport(response(payload), response(payload))
    sdk = client(tmp_path, transport)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: sdk.skills.get(CONTAINER), range(2)))
    assert results[0].path == results[1].path
    assert not list(results[0].path.parent.glob("*.staging-*"))
    assert (results[0].path / f"skills/000000-{INTRO}/root/SKILL.md").is_file()
