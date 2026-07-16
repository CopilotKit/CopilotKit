"""Verified local skill registry client for CopilotKit Intelligence.

The cache is deliberately treated as untrusted input. A successful lookup only
returns after every projected archive and every materialized file is verified.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
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
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen


class IntelligenceError(RuntimeError):
    """Base class for Intelligence registry failures."""


class IntelligenceAccessDeniedError(IntelligenceError):
    """Authentication or authorization was rejected."""


class IntelligenceNotFoundError(IntelligenceError):
    """The requested learning container does not exist."""


class IntelligenceUnavailableError(IntelligenceError):
    """The registry could not be reached or returned a transient failure."""


class IntelligenceIntegrityError(IntelligenceError):
    """Remote or cached registry content failed verification."""


class IntelligenceCacheMissError(IntelligenceError):
    """No fully verified current cache entry exists."""


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

_DEFAULT_PATH = "/api/learning-containers/{learning_container_id}/skills"
_POINTER = ".copilotkit-current.json"
_SET_MANIFEST = ".copilotkit-skill-set.json"
_BLOCKED = ".copilotkit-blocked.json"
_HEX_DIGITS = frozenset("0123456789abcdef")
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


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
    digest = _required_string(value, name).lower()
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
        container = _safe_component(learning_container_id, "learning_container_id")
        pointer = self._pointer_path(container)
        conditional = self._conditional_revision(pointer)
        response = self._request_projection(container, conditional)
        if response.status == 304:
            try:
                return self._read_current(container, freshness="cached")
            except (IntelligenceCacheMissError, IntelligenceIntegrityError):
                response = self._request_projection(container, None)
                if response.status == 304:
                    self._block(container, "invalid-304")
                    raise IntelligenceIntegrityError(
                        "Registry returned 304 without a complete verified cache entry"
                    )
        if response.status != 200:
            self._raise_status(container, response)
        try:
            return self._materialize(container, response)
        except IntelligenceIntegrityError:
            self._block(container, "integrity")
            raise

    def get_cached(self, learning_container_id: str) -> IntelligenceSkillSet:
        container = _safe_component(learning_container_id, "learning_container_id")
        try:
            return self._read_current(container, freshness="cached")
        except IntelligenceIntegrityError as error:
            raise IntelligenceCacheMissError(
                f"No verified cached skill set for {container!r}"
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
            revision = _required_string(
                pointer.get("registryRevision"), "registryRevision"
            )
            etag = pointer.get("etag")
            return etag if isinstance(etag, str) and etag else f'"{revision}"'
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
        detail = ""
        try:
            body = json.loads(response.body)
            if isinstance(body, dict):
                detail = str(body.get("message") or body.get("code") or "")
        except (UnicodeError, json.JSONDecodeError):
            detail = ""
        suffix = f": {detail}" if detail else ""
        if response.status in {401, 403}:
            self._block(container, f"http-{response.status}")
            raise IntelligenceAccessDeniedError(
                f"Intelligence registry access denied{suffix}"
            )
        if response.status in {400, 404, 409, 410, 422}:
            self._block(container, f"http-{response.status}")
            if response.status in {404, 410}:
                raise IntelligenceNotFoundError(
                    f"Intelligence learning container is unavailable{suffix}"
                )
            raise IntelligenceIntegrityError(
                f"Intelligence registry rejected the request ({response.status}){suffix}"
            )
        if response.status == 429 or response.status >= 500:
            raise IntelligenceUnavailableError(
                f"Intelligence registry returned {response.status}{suffix}"
            )
        self._block(container, f"http-{response.status}")
        raise IntelligenceError(
            f"Unexpected Intelligence registry response {response.status}{suffix}"
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
        projected_container = _required_string(
            payload.get("learningContainerId"), "learningContainerId"
        )
        if projected_container != container:
            raise IntelligenceIntegrityError("Projection learningContainerId mismatch")
        _required_string(payload.get("registryRevision"), "registryRevision")
        _valid_hash(payload.get("skillSetHash"), "skillSetHash")
        entries = payload.get("entries", payload.get("skills"))
        if not isinstance(entries, list):
            raise IntelligenceIntegrityError("Projection entries must be an array")
        if not isinstance(payload.get("revoked", False), bool):
            raise IntelligenceIntegrityError("revoked must be a boolean")
        if payload.get("revoked", False) and entries:
            raise IntelligenceIntegrityError("A revoked skill set must be empty")
        calculated = _sha256(
            _canonical_json(
                {"entries": entries, "revoked": bool(payload.get("revoked", False))}
            )
        )
        legacy_calculated = _sha256(_canonical_json(entries))
        if payload["skillSetHash"].lower() not in {calculated, legacy_calculated}:
            raise IntelligenceIntegrityError("Projection skillSetHash mismatch")
        return payload, entries

    def _entry(self, raw: Any, expected_position: int) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise IntelligenceIntegrityError("Projection entry must be an object")
        extra_bundles = [
            key for key in raw if key != "bundle" and "bundle" in str(key).casefold()
        ]
        if extra_bundles:
            raise IntelligenceIntegrityError("Projection contains loose bundle objects")
        skill_id = _safe_component(
            _required_string(raw.get("skillId"), "skillId"), "skillId"
        )
        version = _required_string(raw.get("version"), "version")
        if raw.get("position") != expected_position:
            raise IntelligenceIntegrityError(
                "Projection positions must be contiguous and ordered"
            )
        manifest = raw.get("manifest")
        if not isinstance(manifest, dict):
            raise IntelligenceIntegrityError("Skill manifest must be an object")
        if manifest.get("skillId") != skill_id or manifest.get("version") != version:
            raise IntelligenceIntegrityError("Skill manifest identity mismatch")
        projected_bundle = raw.get("bundle")
        if not isinstance(projected_bundle, dict):
            raise IntelligenceIntegrityError("Skill bundle must be an object")
        digest = _valid_hash(projected_bundle.get("sha256"), "bundle.sha256")
        length = projected_bundle.get("length")
        if not isinstance(length, int) or isinstance(length, bool) or length < 0:
            raise IntelligenceIntegrityError(
                "bundle.length must be a non-negative integer"
            )
        return {
            "skill_id": skill_id,
            "version": version,
            "position": expected_position,
            "manifest": manifest,
            "bundle": projected_bundle,
            "digest": digest,
            "length": length,
        }

    def _bundle_bytes(self, projected: dict[str, Any]) -> bytes:
        if "data" in projected:
            if not isinstance(projected["data"], str):
                raise IntelligenceIntegrityError("bundle.data must be base64 text")
            try:
                return base64.b64decode(projected["data"], validate=True)
            except (ValueError, binascii.Error) as error:
                raise IntelligenceIntegrityError(
                    "bundle.data is not valid base64"
                ) from error
        locator = (
            projected.get("url")
            or projected.get("href")
            or projected.get("downloadUrl")
        )
        if not isinstance(locator, str) or not locator:
            raise IntelligenceIntegrityError("Skill bundle has no locator")
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
            if response.status == 429 or response.status >= 500:
                raise IntelligenceUnavailableError(
                    f"Skill bundle request returned {response.status}"
                )
            raise IntelligenceIntegrityError(
                f"Skill bundle request returned {response.status}"
            )
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
        set_hash = payload["skillSetHash"].lower()
        sets = self._container_dir(container) / "sets"
        target = sets / set_hash
        sets.mkdir(parents=True, exist_ok=True)
        stage = sets / f".{set_hash}.staging-{uuid.uuid4().hex}"
        stage.mkdir()
        materialized: list[dict[str, Any]] = []
        try:
            for entry in entries:
                contents = self._bundle_bytes(entry["bundle"])
                if len(contents) != entry["length"]:
                    raise IntelligenceIntegrityError("Skill bundle length mismatch")
                if _sha256(contents) != entry["digest"]:
                    raise IntelligenceIntegrityError("Skill bundle SHA-256 mismatch")
                skill_directory = (
                    stage / "skills" / f"{entry['position']:06d}-{entry['skill_id']}"
                )
                root, files = self._extract(contents, skill_directory)
                materialized.append(
                    {
                        "skillId": entry["skill_id"],
                        "version": entry["version"],
                        "position": entry["position"],
                        "root": root,
                        "bundleSha256": entry["digest"],
                        "bundleLength": entry["length"],
                        "files": files,
                    }
                )
            cache_manifest = {
                "schemaVersion": 1,
                "learningContainerId": container,
                "registryRevision": payload["registryRevision"],
                "skillSetHash": set_hash,
                "revoked": bool(payload.get("revoked", False)),
                "entries": materialized,
            }
            _write_json(stage / _SET_MANIFEST, cache_manifest)
            self._verify_set(stage, expected_hash=set_hash)
            with _lock_for(target):
                if target.exists():
                    try:
                        self._verify_set(target, expected_hash=set_hash)
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
                        self._verify_set(target, expected_hash=set_hash)
                        shutil.rmtree(stage)
            pointer = {
                "schemaVersion": 1,
                "learningContainerId": container,
                "registryRevision": payload["registryRevision"],
                "skillSetHash": set_hash,
                "etag": _header(response.headers, "etag")
                or f'"{payload["registryRevision"]}"',
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
        entries = manifest.get("entries")
        if not isinstance(entries, list):
            raise IntelligenceIntegrityError("Cached entries must be an array")
        expected_files = {_SET_MANIFEST}
        seen_skills: set[str] = set()
        for position, entry in enumerate(entries):
            if not isinstance(entry, dict) or entry.get("position") != position:
                raise IntelligenceIntegrityError("Cached skill order mismatch")
            skill_id = _safe_component(
                _required_string(entry.get("skillId"), "skillId"), "skillId"
            )
            if skill_id.casefold() in seen_skills:
                raise IntelligenceIntegrityError("Duplicate cached skill identity")
            seen_skills.add(skill_id.casefold())
            root = _safe_component(_required_string(entry.get("root"), "root"), "root")
            prefix = f"skills/{position:06d}-{skill_id}/"
            files = entry.get("files")
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
                full_relative = prefix + relative
                expected_files.add(full_relative)
                actual = path.joinpath(*PurePosixPath(full_relative).parts)
                if not actual.is_file() or actual.is_symlink():
                    raise IntelligenceIntegrityError("Cached skill file missing")
                contents = actual.read_bytes()
                if len(contents) != file.get("length") or _sha256(contents) != file.get(
                    "sha256"
                ):
                    raise IntelligenceIntegrityError("Cached skill file changed")
                if relative == f"{root}/SKILL.md":
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
                version=entry["version"],
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
        return self._result(
            directory / "sets" / set_hash,
            freshness,
            registry_revision=revision,
        )


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
