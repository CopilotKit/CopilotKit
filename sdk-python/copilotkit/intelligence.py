"""Verified local skill registry client for CopilotKit Intelligence.

The cache is deliberately treated as untrusted input. A successful lookup only
returns after every projected archive and every materialized file is verified.
"""

from __future__ import annotations

import asyncio
import errno
import hashlib
import io
import inspect
import json
import os
import shutil
import stat
import threading
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen


class IntelligenceError(RuntimeError):
    """Base class for Intelligence registry failures."""

    default_code = "LEARNING_REGISTRY_UNRECOVERABLE"
    default_category = "internal"
    default_retryable = False

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        category: str | None = None,
        retryable: bool | None = None,
        status: int | None = None,
        request_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code or self.default_code
        self.category = category or self.default_category
        self.retryable = self.default_retryable if retryable is None else retryable
        self.status = status
        self.request_id = request_id
        self.trace_id = trace_id


class IntelligenceAccessDeniedError(IntelligenceError):
    """Authentication or authorization was rejected."""

    default_category = "permission"


class IntelligenceNotFoundError(IntelligenceError):
    """The requested learning container does not exist."""

    default_code = "LEARNING_CONTAINER_NOT_FOUND"
    default_category = "not_found"


class IntelligenceUnavailableError(IntelligenceError):
    """The registry could not be reached or returned a transient failure."""

    default_category = "dependency"
    default_retryable = True


class IntelligenceIntegrityError(IntelligenceError):
    """Remote or cached registry content failed verification."""

    default_code = "LEARNING_BLOB_INTEGRITY_FAILURE"
    default_category = "validation"


class IntelligenceCacheMissError(IntelligenceError):
    """No fully verified current cache entry exists."""

    default_code = "LEARNING_SDK_CACHE_CORRUPT"


@dataclass(frozen=True)
class IntelligenceRequest:
    """Transport-neutral HTTP request passed to injected transports."""

    method: str
    url: str
    headers: Mapping[str, str]


@dataclass(frozen=True)
class IntelligenceResponse:
    """Transport-neutral HTTP response returned by injected transports."""

    status: int
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True)
class IntelligenceSkill:
    """One skill in registry order."""

    skill_id: str
    version: str
    position: int
    path: Path


@dataclass(frozen=True)
class IntelligenceSkillSet:
    """A completely verified skill set."""

    learning_container_id: str
    registry_revision: str
    skill_set_hash: str
    skills: tuple[IntelligenceSkill, ...]
    path: Path
    freshness: str
    revoked: bool


Transport = Callable[[IntelligenceRequest], IntelligenceResponse]

_DEFAULT_PATH = "/v1/learning-containers/{learning_container_id}/skills"
_POINTER = ".copilotkit-current.json"
_SET_MANIFEST = ".copilotkit-skill-set.json"
_BLOCKED = ".copilotkit-blocked.json"
_HEX_DIGITS = frozenset("0123456789abcdef")
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()
_ERROR_CODES = frozenset(
    {
        "LEARNING_CONTAINER_NOT_FOUND",
        "LEARNING_CONTAINER_ARCHIVED",
        "LEARNING_CONTAINER_PROJECT_MISMATCH",
        "LEARNING_CONTAINER_CONFIG_CONFLICT",
        "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
        "LEARNING_CONTAINER_ASSIGNMENT_CONFLICT",
        "LEARNING_RUN_ACTIVE_CONFLICT",
        "LEARNING_RUN_IDEMPOTENCY_CONFLICT",
        "LEARNING_ATTEMPT_FENCE_REJECTED",
        "LEARNING_SNAPSHOT_INVARIANT_VIOLATION",
        "LEARNING_CANDIDATE_STALE_PARENT",
        "LEARNING_CANDIDATE_SUBJECT_MISMATCH",
        "LEARNING_CANDIDATE_GATES_INCOMPLETE",
        "LEARNING_REGISTRY_CONFLICT",
        "LEARNING_REGISTRY_UNRECOVERABLE",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
        "LEARNING_SDK_CACHE_CORRUPT",
    }
)
_ERROR_CATEGORIES = frozenset(
    {
        "validation",
        "auth",
        "permission",
        "not_found",
        "conflict",
        "rate_limit",
        "internal",
        "dependency",
    }
)
_BLOB_PROVIDERS = frozenset(
    {"awsS3", "googleCloudStorage", "azureBlob", "s3Compatible"}
)


def _lock_for(path: Path) -> threading.Lock:
    key = os.path.abspath(path)
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.Lock())


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _sha256(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise IntelligenceIntegrityError(
            f"Invalid JSON cache object: {path}"
        ) from error


def _write_json(path: Path, value: object) -> None:
    path.write_bytes(_canonical_json(value))


def _atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex}")
    try:
        _write_json(temporary, value)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _required_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise IntelligenceIntegrityError(f"{name} must be a non-empty string")
    return value


def _valid_uuid(value: Any, name: str) -> str:
    text = _required_string(value, name)
    try:
        parsed = uuid.UUID(text)
    except (AttributeError, ValueError) as error:
        raise IntelligenceIntegrityError(f"{name} must be a UUID") from error
    if (
        str(parsed) != text.lower()
        or parsed.version not in range(1, 9)
        or parsed.variant != uuid.RFC_4122
    ):
        raise IntelligenceIntegrityError(f"{name} must be a canonical UUID")
    return text


def _valid_timestamp(value: Any, name: str) -> str:
    text = _required_string(value, name)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise IntelligenceIntegrityError(
            f"{name} must be an offset ISO-8601 timestamp"
        ) from error
    if parsed.tzinfo is None:
        raise IntelligenceIntegrityError(f"{name} must be an offset ISO-8601 timestamp")
    return text


def _valid_integer(value: Any, name: str, *, positive: bool = False) -> int:
    minimum = 1 if positive else 0
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < minimum
        or value > 9_007_199_254_740_991
    ):
        qualifier = "positive" if positive else "non-negative"
        raise IntelligenceIntegrityError(f"{name} must be a {qualifier} integer")
    return value


def _safe_component(value: str, name: str) -> str:
    if (
        value in {".", ".."}
        or not value
        or value != unicodedata.normalize("NFC", value)
        or "/" in value
        or "\\" in value
        or "\x00" in value
        or value.startswith("~")
        or (len(value) >= 2 and value[1] == ":")
    ):
        raise IntelligenceIntegrityError(f"Unsafe {name}: {value!r}")
    return value


def _valid_hash(value: Any, name: str) -> str:
    digest = _required_string(value, name)
    if len(digest) != 64 or any(character not in _HEX_DIGITS for character in digest):
        raise IntelligenceIntegrityError(f"{name} must be a SHA-256 hex digest")
    return digest


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.casefold()
    for key, value in headers.items():
        if key.casefold() == lowered:
            return value
    return None


def _default_transport(timeout: float) -> Transport:
    def send(request: IntelligenceRequest) -> IntelligenceResponse:
        raw = Request(request.url, method=request.method, headers=dict(request.headers))
        try:
            with urlopen(raw, timeout=timeout) as opened:  # noqa: S310 - caller controls URL
                return IntelligenceResponse(
                    status=opened.status,
                    headers=MappingProxyType(dict(opened.headers.items())),
                    body=opened.read(),
                )
        except HTTPError as error:
            return IntelligenceResponse(
                status=error.code,
                headers=MappingProxyType(
                    dict(error.headers.items()) if error.headers else {}
                ),
                body=error.read(),
            )

    return send


class _Skills:
    def __init__(
        self,
        *,
        api_key: str,
        project_namespace: str,
        base_url: str,
        cache_dir: Path,
        transport: Transport,
        path_template: str,
        max_archive_bytes: int,
        max_archive_entries: int,
        max_uncompressed_bytes: int,
    ) -> None:
        self._api_key = _required_string(api_key, "api_key")
        self._project_namespace = _required_string(
            project_namespace, "project_namespace"
        )
        self._base_url = base_url.rstrip("/") + "/"
        self._cache = Path(cache_dir)
        self._transport = transport
        self._path_template = path_template
        self._max_archive_bytes = max_archive_bytes
        self._max_archive_entries = max_archive_entries
        self._max_uncompressed_bytes = max_uncompressed_bytes

    def get(self, learning_container_id: str) -> IntelligenceSkillSet:
        container = self._container_id(learning_container_id)
        pointer = self._pointer_path(container)
        conditional = self._conditional_revision(pointer)
        response = self._request_projection(container, conditional)
        if response.status == 304:
            try:
                return self._read_current(container, freshness="fresh")
            except (IntelligenceCacheMissError, IntelligenceIntegrityError):
                response = self._request_projection(container, None)
                if response.status == 304:
                    self._block(container, "invalid-304")
                    raise IntelligenceIntegrityError(
                        "Registry returned 304 without a complete verified cache entry"
                    )
        if response.status != 200:
            self._raise_status(container, response)
        return self._materialize(container, response)

    def get_cached(self, learning_container_id: str) -> IntelligenceSkillSet:
        container = self._container_id(learning_container_id)
        try:
            return self._read_current(container, freshness="cached")
        except IntelligenceIntegrityError as error:
            raise IntelligenceCacheMissError(
                f"No verified cached skill set for {container!r}"
            ) from error

    @staticmethod
    def _container_id(value: str) -> str:
        try:
            return _safe_component(
                _valid_uuid(value, "learning_container_id"),
                "learning_container_id",
            )
        except IntelligenceIntegrityError as error:
            raise IntelligenceIntegrityError(
                "learning_container_id must be a canonical UUID",
                code="LEARNING_REGISTRY_UNRECOVERABLE",
                category="validation",
            ) from error

    def _container_dir(self, container: str) -> Path:
        namespace = _sha256(self._project_namespace.encode("utf-8"))
        return self._cache / "v1" / namespace / container

    def _pointer_path(self, container: str) -> Path:
        return self._container_dir(container) / _POINTER

    def _conditional_revision(self, pointer_path: Path) -> str | None:
        if not pointer_path.is_file():
            return None
        try:
            pointer = _read_json(pointer_path)
            etag = _required_string(pointer.get("etag"), "etag")
            return etag
        except (AttributeError, IntelligenceIntegrityError):
            return None

    def _projection_url(self, container: str) -> str:
        try:
            path = self._path_template.format(
                learning_container_id=quote(container, safe="")
            )
        except (KeyError, ValueError) as error:
            raise IntelligenceError(
                "Invalid Intelligence skills path template"
            ) from error
        return urljoin(self._base_url, path.lstrip("/"))

    def _send(self, request: IntelligenceRequest) -> IntelligenceResponse:
        try:
            response = self._transport(request)
        except (OSError, URLError) as error:
            raise IntelligenceUnavailableError(
                "Intelligence registry is unavailable"
            ) from error
        if not isinstance(response, IntelligenceResponse):
            raise IntelligenceError(
                "Intelligence transport returned an invalid response"
            )
        return response

    def _request_projection(
        self, container: str, conditional: str | None
    ) -> IntelligenceResponse:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._api_key}",
            "X-CopilotKit-Project-Namespace": self._project_namespace,
        }
        if conditional:
            headers["If-None-Match"] = conditional
        return self._send(
            IntelligenceRequest(
                method="GET",
                url=self._projection_url(container),
                headers=MappingProxyType(headers),
            )
        )

    def _raise_status(self, container: str, response: IntelligenceResponse) -> None:
        status_blocks_cache = response.status in {401, 403, 404, 410}
        if status_blocks_cache:
            self._block(container, f"http-{response.status}")
        try:
            body = json.loads(response.body)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise IntelligenceUnavailableError(
                f"Registry request failed with HTTP {response.status}",
                retryable=response.status >= 500,
                status=response.status,
            ) from error
        try:
            if not isinstance(body, dict) or not isinstance(body.get("error"), dict):
                raise IntelligenceIntegrityError("error envelope must be an object")
            canonical = body["error"]
            code = _required_string(canonical.get("code"), "error.code")
            message = _required_string(canonical.get("message"), "error.message")
            category = _required_string(canonical.get("category"), "error.category")
            retryable = canonical.get("retryable")
            request_id = _required_string(body.get("requestId"), "requestId")
            trace_id = _required_string(body.get("traceId"), "traceId")
            if code not in _ERROR_CODES:
                raise IntelligenceIntegrityError("unknown canonical error code")
            if category not in _ERROR_CATEGORIES:
                raise IntelligenceIntegrityError("unknown canonical error category")
            if not isinstance(retryable, bool):
                raise IntelligenceIntegrityError("error.retryable must be a boolean")
        except IntelligenceIntegrityError as error:
            raise IntelligenceUnavailableError(
                f"Registry returned a non-canonical HTTP {response.status} error",
                retryable=response.status >= 500,
                status=response.status,
            ) from error

        blocks_cache = status_blocks_cache or code in {
            "LEARNING_REGISTRY_UNRECOVERABLE",
            "LEARNING_CONTAINER_ARCHIVED",
            "LEARNING_CONTAINER_PROJECT_MISMATCH",
            "LEARNING_CONTAINER_NOT_FOUND",
        }
        if blocks_cache and not status_blocks_cache:
            self._block(container, code)

        error_type: type[IntelligenceError]
        if response.status in {401, 403}:
            error_type = IntelligenceAccessDeniedError
        elif response.status in {404, 410} or code in {
            "LEARNING_CONTAINER_ARCHIVED",
            "LEARNING_CONTAINER_NOT_FOUND",
        }:
            error_type = IntelligenceNotFoundError
        elif response.status == 429 or response.status >= 500:
            error_type = IntelligenceUnavailableError
        else:
            error_type = IntelligenceError
        raise error_type(
            message,
            code=code,
            category=category,
            retryable=retryable,
            status=response.status,
            request_id=request_id,
            trace_id=trace_id,
        )

    def _block(self, container: str, reason: str) -> None:
        directory = self._container_dir(container)
        directory.mkdir(parents=True, exist_ok=True)
        with _lock_for(directory):
            self._pointer_path(container).unlink(missing_ok=True)
            _atomic_json(directory / _BLOCKED, {"reason": reason})

    def _decode_projection(
        self, container: str, body: bytes
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        try:
            payload = json.loads(body)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise IntelligenceIntegrityError(
                "Registry projection is not valid JSON"
            ) from error
        if not isinstance(payload, dict):
            raise IntelligenceIntegrityError("Registry projection must be an object")
        if payload.get("schemaVersion") != 1:
            raise IntelligenceIntegrityError("schemaVersion must be 1")
        projected_container = _valid_uuid(
            payload.get("learningContainerId"), "learningContainerId"
        )
        if projected_container != container:
            raise IntelligenceIntegrityError("Projection learningContainerId mismatch")
        _required_string(payload.get("registryRevision"), "registryRevision")
        _valid_hash(payload.get("skillSetHash"), "skillSetHash")
        _required_string(payload.get("etag"), "etag")
        _valid_timestamp(payload.get("publishedAt"), "publishedAt")
        entries = payload.get("entries")
        if not isinstance(entries, list):
            raise IntelligenceIntegrityError("Projection entries must be an array")
        if not isinstance(payload.get("revoked"), bool):
            raise IntelligenceIntegrityError("revoked must be a boolean")
        if payload["revoked"] and entries:
            raise IntelligenceIntegrityError("A revoked skill set must be empty")
        return payload, entries

    def _entry(self, raw: Any, expected_position: int) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise IntelligenceIntegrityError("Projection entry must be an object")
        skill_id = _safe_component(
            _valid_uuid(raw.get("skillId"), "skillId"), "skillId"
        )
        version_id = _safe_component(
            _valid_uuid(raw.get("versionId"), "versionId"), "versionId"
        )
        if _valid_integer(raw.get("position"), "position") != expected_position:
            raise IntelligenceIntegrityError(
                "Projection positions must be contiguous and ordered"
            )
        if expected_position > 999_999:
            raise IntelligenceIntegrityError("Projection position exceeds cache bound")
        _required_string(raw.get("name"), "name")
        if "description" not in raw or not (
            raw["description"] is None or isinstance(raw["description"], str)
        ):
            raise IntelligenceIntegrityError("description must be a string or null")
        if raw.get("approvalMethod") not in {"manual", "automatic"}:
            raise IntelligenceIntegrityError("approvalMethod is invalid")
        bundle_sha = _valid_hash(raw.get("bundleSha256"), "bundleSha256")
        manifest_sha = _valid_hash(raw.get("manifestSha256"), "manifestSha256")
        bundle_length = _valid_integer(
            raw.get("bundleByteLength"), "bundleByteLength", positive=True
        )
        locator = raw.get("bundleLocator")
        if not isinstance(locator, dict) or locator.get("schemaVersion") != 1:
            raise IntelligenceIntegrityError("bundleLocator must be canonical V1")
        for key in ("providerVersion", "etag", "providerChecksum"):
            if key not in locator:
                raise IntelligenceIntegrityError(f"bundleLocator.{key} is required")
        for key in ("backendId", "resource", "key", "contentType"):
            _required_string(locator.get(key), f"bundleLocator.{key}")
        if locator.get("provider") not in _BLOB_PROVIDERS:
            raise IntelligenceIntegrityError("bundleLocator.provider is invalid")
        locator_sha = _valid_hash(
            locator.get("applicationSha256"),
            "bundleLocator.applicationSha256",
        )
        locator_length = _valid_integer(
            locator.get("byteLength"), "bundleLocator.byteLength"
        )
        if locator.get("providerVersion") is not None and not isinstance(
            locator.get("providerVersion"), str
        ):
            raise IntelligenceIntegrityError("bundleLocator.providerVersion is invalid")
        if locator.get("etag") is not None and not isinstance(locator.get("etag"), str):
            raise IntelligenceIntegrityError("bundleLocator.etag is invalid")
        if locator.get("providerChecksum") is not None and not isinstance(
            locator.get("providerChecksum"), dict
        ):
            raise IntelligenceIntegrityError(
                "bundleLocator.providerChecksum is invalid"
            )
        manifest = raw.get("manifest")
        if not isinstance(manifest, dict):
            raise IntelligenceIntegrityError(
                "Skill artifact manifest must be an object"
            )
        if manifest.get("manifestVersion") != 1:
            raise IntelligenceIntegrityError("manifestVersion must be 1")
        _required_string(manifest.get("agentSkillsProfile"), "agentSkillsProfile")
        files = manifest.get("files")
        if not isinstance(files, list) or not files:
            raise IntelligenceIntegrityError("manifest.files must be non-empty")
        if not isinstance(manifest.get("provenance"), dict):
            raise IntelligenceIntegrityError("manifest.provenance must be an object")
        if (
            _valid_hash(manifest.get("bundleSha256"), "manifest.bundleSha256")
            != bundle_sha
            or _valid_integer(
                manifest.get("bundleByteLength"),
                "manifest.bundleByteLength",
                positive=True,
            )
            != bundle_length
            or _valid_hash(manifest.get("manifestSha256"), "manifest.manifestSha256")
            != manifest_sha
        ):
            raise IntelligenceIntegrityError("Artifact manifest identity mismatch")
        hashable = {
            key: value for key, value in manifest.items() if key != "manifestSha256"
        }
        if _sha256(_canonical_json(hashable)) != manifest_sha:
            raise IntelligenceIntegrityError("Artifact manifest hash mismatch")
        collisions: set[str] = set()
        for file in files:
            if not isinstance(file, dict):
                raise IntelligenceIntegrityError("manifest file must be an object")
            path = _required_string(file.get("path"), "manifest.file.path")
            pure = PurePosixPath(path)
            if pure.is_absolute() or any(
                part in {"", ".", ".."} for part in pure.parts
            ):
                raise IntelligenceIntegrityError("Unsafe manifest file path")
            _required_string(file.get("role"), "manifest.file.role")
            _required_string(file.get("mediaType"), "manifest.file.mediaType")
            _valid_integer(file.get("byteLength"), "manifest.file.byteLength")
            _valid_hash(file.get("rawSha256"), "manifest.file.rawSha256")
            collision = unicodedata.normalize("NFC", path).casefold()
            if collision in collisions:
                raise IntelligenceIntegrityError("Colliding manifest file paths")
            collisions.add(collision)
        if not any(file.get("path") == "SKILL.md" for file in files):
            raise IntelligenceIntegrityError("Artifact manifest must contain SKILL.md")
        if locator_sha != bundle_sha or locator_length != bundle_length:
            raise IntelligenceIntegrityError("Bundle locator identity mismatch")
        return {
            "skill_id": skill_id,
            "version_id": version_id,
            "position": expected_position,
            "manifest": manifest,
            "digest": bundle_sha,
            "length": bundle_length,
            "download_url": raw.get("downloadUrl"),
        }

    def _bundle_bytes(self, container: str, projected: dict[str, Any]) -> bytes:
        locator = projected.get("download_url")
        if locator is None:
            locator = (
                f"{self._projection_url(container)}/"
                f"{quote(projected['skill_id'], safe='')}/versions/"
                f"{quote(projected['version_id'], safe='')}/bundle"
            )
        if not isinstance(locator, str) or not locator:
            raise IntelligenceIntegrityError("Skill bundle has no canonical locator")
        response = self._send(
            IntelligenceRequest(
                method="GET",
                url=urljoin(self._base_url, locator),
                headers=MappingProxyType(
                    {
                        "Accept": "application/zip",
                        "Authorization": f"Bearer {self._api_key}",
                        "X-CopilotKit-Project-Namespace": self._project_namespace,
                    }
                ),
            )
        )
        if response.status != 200:
            self._raise_status(container, response)
        return response.body

    def _safe_members(
        self, archive: zipfile.ZipFile
    ) -> tuple[list[zipfile.ZipInfo], str]:
        members = archive.infolist()
        if not members or len(members) > self._max_archive_entries:
            raise IntelligenceIntegrityError("Skill archive entry bound exceeded")
        total = sum(member.file_size for member in members)
        if total > self._max_uncompressed_bytes:
            raise IntelligenceIntegrityError("Skill archive expansion bound exceeded")
        roots: set[str] = set()
        collisions: set[str] = set()
        safe: list[zipfile.ZipInfo] = []
        for member in members:
            name = member.filename
            if not name or "\\" in name or "\x00" in name:
                raise IntelligenceIntegrityError("Unsafe ZIP member name")
            raw_parts = name.rstrip("/").split("/")
            if not raw_parts or any(part in {"", ".", ".."} for part in raw_parts):
                raise IntelligenceIntegrityError("Unsafe ZIP member path")
            path = PurePosixPath(name)
            if path.is_absolute() or any(
                part in {"", ".", ".."} for part in path.parts
            ):
                raise IntelligenceIntegrityError("Unsafe ZIP member path")
            if path.parts[0].endswith(":"):
                raise IntelligenceIntegrityError("Absolute ZIP member path")
            roots.add(path.parts[0])
            collision_key = "/".join(
                unicodedata.normalize("NFC", part).casefold() for part in path.parts
            ).rstrip("/")
            if collision_key in collisions:
                raise IntelligenceIntegrityError(
                    "Case or Unicode-colliding ZIP members"
                )
            collisions.add(collision_key)
            mode = member.external_attr >> 16
            file_type = stat.S_IFMT(mode)
            if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise IntelligenceIntegrityError(
                    "ZIP links and special files are forbidden"
                )
            safe.append(member)
        if len(roots) != 1:
            raise IntelligenceIntegrityError("Skill archive must have exactly one root")
        root = next(iter(roots))
        skill_md = f"{root}/SKILL.md"
        if not any(member.filename.rstrip("/") == skill_md for member in members):
            raise IntelligenceIntegrityError("Skill archive root must contain SKILL.md")
        return safe, root

    def _extract(
        self, contents: bytes, destination: Path
    ) -> tuple[str, list[dict[str, Any]]]:
        if len(contents) > self._max_archive_bytes:
            raise IntelligenceIntegrityError("Skill archive byte bound exceeded")
        try:
            with zipfile.ZipFile(io.BytesIO(contents)) as archive:
                members, root = self._safe_members(archive)
                files: list[dict[str, Any]] = []
                for member in members:
                    relative = PurePosixPath(member.filename)
                    target = destination.joinpath(*relative.parts)
                    if member.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    data = archive.read(member)
                    target.write_bytes(data)
                    files.append(
                        {
                            "path": relative.as_posix(),
                            "sha256": _sha256(data),
                            "length": len(data),
                        }
                    )
                return root, files
        except (zipfile.BadZipFile, RuntimeError, OSError) as error:
            raise IntelligenceIntegrityError("Invalid skill ZIP archive") from error

    def _materialize(
        self, container: str, response: IntelligenceResponse
    ) -> IntelligenceSkillSet:
        payload, raw_entries = self._decode_projection(container, response.body)
        entries = [self._entry(raw, index) for index, raw in enumerate(raw_entries)]
        skill_ids = [entry["skill_id"].casefold() for entry in entries]
        if len(skill_ids) != len(set(skill_ids)):
            raise IntelligenceIntegrityError("Duplicate skill identities in projection")
        set_hash = payload["skillSetHash"]
        sets = self._container_dir(container) / "sets"
        target = sets / set_hash
        sets.mkdir(parents=True, exist_ok=True)
        stage = sets / f".{set_hash}.staging-{uuid.uuid4().hex}"
        stage.mkdir()
        materialized: list[dict[str, Any]] = []
        try:
            for entry in entries:
                contents = self._bundle_bytes(container, entry)
                if len(contents) != entry["length"]:
                    raise IntelligenceIntegrityError("Skill bundle length mismatch")
                if _sha256(contents) != entry["digest"]:
                    raise IntelligenceIntegrityError("Skill bundle SHA-256 mismatch")
                skill_directory = (
                    stage / "skills" / f"{entry['position']:06d}-{entry['skill_id']}"
                )
                root, files = self._extract(contents, skill_directory)
                relative_files = [
                    {
                        **file,
                        "path": file["path"][len(root) + 1 :],
                    }
                    for file in files
                ]
                manifest_files = entry["manifest"]["files"]
                if [file["path"] for file in relative_files] != [
                    file["path"] for file in manifest_files
                ]:
                    raise IntelligenceIntegrityError(
                        "ZIP files do not exactly match manifest order"
                    )
                for actual, expected in zip(
                    relative_files, manifest_files, strict=True
                ):
                    if (
                        actual["length"] != expected["byteLength"]
                        or actual["sha256"] != expected["rawSha256"]
                    ):
                        raise IntelligenceIntegrityError(
                            f"Bundle file failed integrity verification: {actual['path']}"
                        )
                materialized.append(
                    {
                        "skillId": entry["skill_id"],
                        "versionId": entry["version_id"],
                        "position": entry["position"],
                        "root": root,
                        "manifest": entry["manifest"],
                    }
                )
            cache_manifest = {
                "schemaVersion": 1,
                "learningContainerId": container,
                "registryRevision": payload["registryRevision"],
                "skillSetHash": set_hash,
                "revoked": payload["revoked"],
                "projection": payload,
                "entries": materialized,
            }
            _write_json(stage / _SET_MANIFEST, cache_manifest)
            self._verify_set(stage, expected_hash=set_hash)
            with _lock_for(target):
                if target.exists():
                    try:
                        winner = self._verify_set(target, expected_hash=set_hash)
                        self._assert_projection_matches_cached(payload, winner)
                        shutil.rmtree(stage)
                    except IntelligenceIntegrityError:
                        quarantine = target.with_name(
                            f".{target.name}.corrupt-{uuid.uuid4().hex}"
                        )
                        os.rename(target, quarantine)
                        os.rename(stage, target)
                        shutil.rmtree(quarantine, ignore_errors=True)
                else:
                    try:
                        os.rename(stage, target)
                    except OSError as error:
                        if error.errno not in {errno.EEXIST, errno.ENOTEMPTY}:
                            raise
                        # Another process won the atomic rename. Its result is
                        # reusable only after the same full cache verification.
                        winner = self._verify_set(target, expected_hash=set_hash)
                        self._assert_projection_matches_cached(payload, winner)
                        shutil.rmtree(stage)
            pointer = {
                "schemaVersion": 1,
                "learningContainerId": container,
                "registryRevision": payload["registryRevision"],
                "skillSetHash": set_hash,
                "etag": payload["etag"],
                "projection": payload,
            }
            directory = self._container_dir(container)
            with _lock_for(directory):
                (directory / _BLOCKED).unlink(missing_ok=True)
                _atomic_json(directory / _POINTER, pointer)
            return self._result(
                target, "fresh", registry_revision=payload["registryRevision"]
            )
        finally:
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)

    def _verify_set(
        self, path: Path, expected_hash: str | None = None
    ) -> dict[str, Any]:
        if not path.is_dir() or path.is_symlink():
            raise IntelligenceIntegrityError("Cached skill set is not a directory")
        manifest = _read_json(path / _SET_MANIFEST)
        if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
            raise IntelligenceIntegrityError("Invalid cached skill set manifest")
        set_hash = _valid_hash(manifest.get("skillSetHash"), "skillSetHash")
        if expected_hash and set_hash != expected_hash:
            raise IntelligenceIntegrityError("Cached skill set hash mismatch")
        is_stage = path.name.startswith(f".{set_hash}.staging-")
        if path.name != set_hash and not (expected_hash and is_stage):
            raise IntelligenceIntegrityError("Cached skill set path mismatch")
        container = _valid_uuid(
            manifest.get("learningContainerId"), "learningContainerId"
        )
        projection, projected_entries = self._decode_projection(
            container, _canonical_json(manifest.get("projection"))
        )
        if projection["skillSetHash"] != set_hash:
            raise IntelligenceIntegrityError("Cached projection hash mismatch")
        entries = manifest.get("entries")
        if not isinstance(entries, list) or len(entries) != len(projected_entries):
            raise IntelligenceIntegrityError("Cached entries must be an array")
        expected_files = {_SET_MANIFEST}
        seen_skills: set[str] = set()
        for position, entry in enumerate(entries):
            if not isinstance(entry, dict) or entry.get("position") != position:
                raise IntelligenceIntegrityError("Cached skill order mismatch")
            skill_id = _safe_component(
                _valid_uuid(entry.get("skillId"), "skillId"), "skillId"
            )
            if skill_id.casefold() in seen_skills:
                raise IntelligenceIntegrityError("Duplicate cached skill identity")
            seen_skills.add(skill_id.casefold())
            version_id = _valid_uuid(entry.get("versionId"), "versionId")
            projected = self._entry(projected_entries[position], position)
            if (
                projected["skill_id"] != skill_id
                or projected["version_id"] != version_id
            ):
                raise IntelligenceIntegrityError("Cached skill identity mismatch")
            root = _safe_component(_required_string(entry.get("root"), "root"), "root")
            prefix = f"skills/{position:06d}-{skill_id}/"
            cached_manifest = entry.get("manifest")
            if cached_manifest != projected["manifest"]:
                raise IntelligenceIntegrityError("Cached artifact manifest mismatch")
            files = projected["manifest"].get("files")
            if not isinstance(files, list):
                raise IntelligenceIntegrityError("Cached file manifest missing")
            found_skill_md = False
            collision_keys: set[str] = set()
            for file in files:
                if not isinstance(file, dict):
                    raise IntelligenceIntegrityError("Invalid cached file record")
                relative = _required_string(file.get("path"), "file.path")
                pure = PurePosixPath(relative)
                if pure.is_absolute() or any(
                    part in {"", ".", ".."} for part in pure.parts
                ):
                    raise IntelligenceIntegrityError("Unsafe cached file path")
                key = unicodedata.normalize("NFC", relative).casefold()
                if key in collision_keys:
                    raise IntelligenceIntegrityError("Colliding cached file paths")
                collision_keys.add(key)
                full_relative = prefix + root + "/" + relative
                expected_files.add(full_relative)
                actual = path.joinpath(*PurePosixPath(full_relative).parts)
                if not actual.is_file() or actual.is_symlink():
                    raise IntelligenceIntegrityError("Cached skill file missing")
                contents = actual.read_bytes()
                if len(contents) != file.get("byteLength") or _sha256(
                    contents
                ) != file.get("rawSha256"):
                    raise IntelligenceIntegrityError("Cached skill file changed")
                if relative == "SKILL.md":
                    found_skill_md = True
            if not found_skill_md:
                raise IntelligenceIntegrityError("Cached skill has no root SKILL.md")
        actual_files = {
            item.relative_to(path).as_posix()
            for item in path.rglob("*")
            if item.is_file() or item.is_symlink()
        }
        if actual_files != expected_files:
            raise IntelligenceIntegrityError(
                "Cached skill set has loose or missing files"
            )
        return manifest

    @staticmethod
    def _assert_projection_matches_cached(
        projection: dict[str, Any], cached_manifest: dict[str, Any]
    ) -> None:
        cached_projection = cached_manifest.get("projection")
        if not isinstance(cached_projection, dict):
            raise IntelligenceIntegrityError("Cached projection is missing")
        current = projection.get("entries")
        cached = cached_projection.get("entries")
        if not isinstance(current, list) or not isinstance(cached, list):
            raise IntelligenceIntegrityError("Cached projection entries are invalid")
        if len(current) != len(cached):
            raise IntelligenceIntegrityError(
                "Skill-set hash resolved to a different skill count"
            )
        immutable_keys = (
            "skillId",
            "versionId",
            "position",
            "bundleSha256",
            "manifestSha256",
            "bundleByteLength",
        )
        for current_entry, cached_entry in zip(current, cached, strict=True):
            if not isinstance(current_entry, dict) or not isinstance(
                cached_entry, dict
            ):
                raise IntelligenceIntegrityError("Cached projection entry is invalid")
            if any(
                current_entry.get(key) != cached_entry.get(key)
                for key in immutable_keys
            ):
                raise IntelligenceIntegrityError(
                    "Skill-set hash resolved to different immutable skill content"
                )

    def _result(
        self,
        path: Path,
        freshness: str,
        registry_revision: str | None = None,
    ) -> IntelligenceSkillSet:
        manifest = self._verify_set(path)
        skills = tuple(
            IntelligenceSkill(
                skill_id=entry["skillId"],
                version=entry["versionId"],
                position=entry["position"],
                path=path
                / "skills"
                / f"{entry['position']:06d}-{entry['skillId']}"
                / entry["root"],
            )
            for entry in manifest["entries"]
        )
        return IntelligenceSkillSet(
            learning_container_id=manifest["learningContainerId"],
            registry_revision=registry_revision or manifest["registryRevision"],
            skill_set_hash=manifest["skillSetHash"],
            skills=skills,
            path=path,
            freshness=freshness,
            revoked=bool(manifest.get("revoked", False)),
        )

    def _read_current(self, container: str, freshness: str) -> IntelligenceSkillSet:
        directory = self._container_dir(container)
        if (directory / _BLOCKED).exists() or not (directory / _POINTER).is_file():
            raise IntelligenceCacheMissError(
                f"No verified cached skill set for {container!r}"
            )
        pointer = _read_json(directory / _POINTER)
        if (
            not isinstance(pointer, dict)
            or pointer.get("learningContainerId") != container
        ):
            raise IntelligenceIntegrityError("Invalid current cache pointer")
        set_hash = _valid_hash(pointer.get("skillSetHash"), "skillSetHash")
        revision = _required_string(pointer.get("registryRevision"), "registryRevision")
        etag = _required_string(pointer.get("etag"), "etag")
        projection, _ = self._decode_projection(
            container, _canonical_json(pointer.get("projection"))
        )
        if (
            projection["skillSetHash"] != set_hash
            or projection["registryRevision"] != revision
            or projection["etag"] != etag
        ):
            raise IntelligenceIntegrityError("Current cache pointer mismatch")
        target = directory / "sets" / set_hash
        cached_manifest = self._verify_set(target, expected_hash=set_hash)
        self._assert_projection_matches_cached(projection, cached_manifest)
        return self._result(target, freshness, registry_revision=revision)


class CopilotKitIntelligence:
    """Synchronous CopilotKit Intelligence registry client."""

    def __init__(
        self,
        *,
        api_key: str,
        project_namespace: str,
        base_url: str = "https://api.cloud.copilotkit.ai",
        cache_dir: str | os.PathLike[str] = ".copilotkit/intelligence",
        transport: Transport | None = None,
        skills_path: str = _DEFAULT_PATH,
        max_archive_bytes: int = 50 * 1024 * 1024,
        max_archive_entries: int = 10_000,
        max_uncompressed_bytes: int = 100 * 1024 * 1024,
        timeout: float = 30.0,
    ) -> None:
        if min(max_archive_bytes, max_archive_entries, max_uncompressed_bytes) <= 0:
            raise ValueError("Archive bounds must be positive")
        self.skills = _Skills(
            api_key=api_key,
            project_namespace=project_namespace,
            base_url=base_url,
            cache_dir=Path(cache_dir),
            transport=transport or _default_transport(timeout),
            path_template=skills_path,
            max_archive_bytes=max_archive_bytes,
            max_archive_entries=max_archive_entries,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )


class _AsyncSkills:
    def __init__(self, skills: _Skills) -> None:
        self._skills = skills

    async def get(self, learning_container_id: str) -> IntelligenceSkillSet:
        return await asyncio.to_thread(self._skills.get, learning_container_id)

    async def get_cached(self, learning_container_id: str) -> IntelligenceSkillSet:
        return await asyncio.to_thread(self._skills.get_cached, learning_container_id)


class AsyncCopilotKitIntelligence:
    """Async registry client with equivalent behavior and non-blocking I/O."""

    def __init__(self, **options: Any) -> None:
        options = dict(options)
        transport = options.get("transport")
        if transport is not None:

            def bridged_transport(
                request: IntelligenceRequest,
            ) -> IntelligenceResponse:
                result = transport(request)
                if inspect.isawaitable(result):
                    return asyncio.run(result)
                return result

            options["transport"] = bridged_transport
        synchronous = CopilotKitIntelligence(**options)
        self.skills = _AsyncSkills(synchronous.skills)


__all__ = [
    "AsyncCopilotKitIntelligence",
    "CopilotKitIntelligence",
    "IntelligenceAccessDeniedError",
    "IntelligenceCacheMissError",
    "IntelligenceError",
    "IntelligenceIntegrityError",
    "IntelligenceNotFoundError",
    "IntelligenceRequest",
    "IntelligenceResponse",
    "IntelligenceSkill",
    "IntelligenceSkillSet",
    "IntelligenceUnavailableError",
]
