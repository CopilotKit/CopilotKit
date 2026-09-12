"""Validate complete skill snapshots in memory before registry installation."""

import hashlib
import io
import json
import re
import struct
import zipfile
import zlib
from dataclasses import dataclass

from copilotkit_intelligence import LearnedSkillsError

MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 1000


@dataclass(frozen=True, slots=True)
class SnapshotFile:
    path: str
    size: int
    sha256: str
    text: str | None


@dataclass(frozen=True, slots=True)
class SnapshotSkill:
    name: str
    description: str
    files: tuple[SnapshotFile, ...]


@dataclass(frozen=True, slots=True)
class VerifiedSnapshot:
    revision: str
    etag: str
    skills: tuple[SnapshotSkill, ...]


def invalid_snapshot(cause: BaseException | None = None) -> LearnedSkillsError:
    return LearnedSkillsError("INVALID_SNAPSHOT", False, cause)


def safe_path(path: object) -> bool:
    return (
        isinstance(path, str)
        and bool(path)
        and not re.search(r"[\\\x00-\x1f\x7f]", path)
        and not re.match(r"^[a-z]:", path, re.IGNORECASE)
        and all(part not in ("", ".", "..") for part in path.split("/"))
    )


def _archive(data: bytes) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    names: set[str] = set()
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ARCHIVE_ENTRIES:
            raise invalid_snapshot()
        for entry in entries:
            # Recover exact bytes even when the UTF-8 bit is absent. Do not use
            # zipfile's CP437 fallback or its NUL-truncated filename for lookup.
            raw_name = entry.orig_filename.encode("utf-8" if entry.flag_bits & 0x800 else "cp437")
            name = raw_name.decode("utf-8", errors="strict")
            directory = name.endswith("/")
            kind = (entry.external_attr >> 16) & 0o170000
            total += entry.file_size
            if (
                not safe_path(name[:-1] if directory else name)
                or name in names
                or kind not in (0, 0o040000 if directory else 0o100000)
                or entry.flag_bits & 1
                or entry.compress_type not in (0, 8)
                or entry.file_size < 0
                or total > MAX_SNAPSHOT_BYTES
                or (directory and entry.file_size != 0)
            ):
                raise invalid_snapshot()
            names.add(name)
            offset = entry.header_offset
            if offset < 0 or offset + 30 > len(data):
                raise invalid_snapshot()
            signature, _, flags, method, _, _, _, compressed, decoded, name_length, extra_length = (
                struct.unpack_from("<IHHHHHIIIHH", data, offset)
            )
            start = offset + 30 + name_length + extra_length
            if (
                signature != 0x04034B50
                or flags != entry.flag_bits
                or method != entry.compress_type
                or data[offset + 30 : offset + 30 + name_length] != raw_name
                or start + entry.compress_size > len(data)
                or (
                    not flags & 8
                    and (compressed != entry.compress_size or decoded != entry.file_size)
                )
            ):
                raise invalid_snapshot()
            payload = data[start : start + entry.compress_size]
            if method == 8:
                decoder = zlib.decompressobj(-15)
                content = decoder.decompress(payload, entry.file_size + 1)
                if not decoder.eof or decoder.unconsumed_tail or decoder.unused_data:
                    raise invalid_snapshot()
            else:
                content = payload
            if len(content) != entry.file_size or zlib.crc32(content) != entry.CRC:
                raise invalid_snapshot()
            if not directory:
                files[name] = content
    return files


def validate_snapshot(response: object) -> VerifiedSnapshot:
    """Return only immutable text and metadata; retain no caller-owned buffers."""
    try:
        if not isinstance(response, dict):
            raise invalid_snapshot()
        raw = response.get("bytes")
        revision, etag, media = (
            response.get("revision"),
            response.get("etag"),
            response.get("contentType"),
        )
        if (
            response.get("status") != "snapshot"
            or not isinstance(raw, (bytes, bytearray))
            or len(raw) > MAX_SNAPSHOT_BYTES
            or not isinstance(revision, str)
            or not revision
            or not isinstance(etag, str)
            or re.fullmatch(r'"[a-f0-9]{64}"', etag) is None
            or not isinstance(media, str)
            or media.split(";", 1)[0].strip().lower() != "application/zip"
        ):
            raise invalid_snapshot()
        data = bytes(raw)
        if '"' + hashlib.sha256(data).hexdigest() + '"' != etag:
            raise invalid_snapshot()
        archive = _archive(data)
        manifest = json.loads(archive["manifest.json"].decode("utf-8", errors="strict"))
        if not isinstance(manifest, dict):
            raise invalid_snapshot()
        version = manifest.get("schemaVersion")
        if type(version) in (int, float) and version != 1:
            raise LearnedSkillsError("UNSUPPORTED_SERVER", False)
        if (
            type(version) not in (int, float)
            or version != 1
            or manifest.get("revision") != revision
            or not isinstance(manifest.get("skills"), list)
        ):
            raise invalid_snapshot()
        expected = {"manifest.json"}
        skills: list[SnapshotSkill] = []
        previous_name: bytes | None = None
        for skill in manifest["skills"]:
            if not isinstance(skill, dict):
                raise invalid_snapshot()
            name, description = skill.get("name"), skill.get("description")
            if (
                not isinstance(name, str)
                or not safe_path(name)
                or "/" in name
                or not isinstance(description, str)
                or not isinstance(skill.get("files"), list)
            ):
                raise invalid_snapshot()
            encoded_name = name.encode("utf-8", errors="strict")
            if previous_name is not None and previous_name >= encoded_name:
                raise invalid_snapshot()
            previous_name = encoded_name
            previous_path: bytes | None = None
            files: list[SnapshotFile] = []
            has_skill = False
            for file in skill["files"]:
                if not isinstance(file, dict):
                    raise invalid_snapshot()
                path, size, digest = file.get("path"), file.get("size"), file.get("sha256")
                if (
                    not isinstance(path, str)
                    or not safe_path(path)
                    or not isinstance(size, (int, float))
                    or isinstance(size, bool)
                    or size < 0
                    or size > MAX_SNAPSHOT_BYTES
                    or int(size) != size
                    or not isinstance(digest, str)
                    or re.fullmatch(r"[a-f0-9]{64}", digest) is None
                ):
                    raise invalid_snapshot()
                encoded_path = path.encode("utf-8", errors="strict")
                if previous_path is not None and previous_path >= encoded_path:
                    raise invalid_snapshot()
                previous_path = encoded_path
                full_path = name + "/" + path
                if full_path in expected:
                    raise invalid_snapshot()
                expected.add(full_path)
                content = archive[full_path]
                if len(content) != size or hashlib.sha256(content).hexdigest() != digest:
                    raise invalid_snapshot()
                try:
                    text = content.decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    text = None
                if path == "SKILL.md":
                    if text is None:
                        raise invalid_snapshot()
                    has_skill = True
                files.append(SnapshotFile(path, int(size), digest, text))
            if not has_skill:
                raise invalid_snapshot()
            skills.append(SnapshotSkill(name, description, tuple(files)))
        if expected != archive.keys():
            raise invalid_snapshot()
        return VerifiedSnapshot(revision, etag, tuple(skills))
    except LearnedSkillsError:
        raise
    except Exception as error:
        raise invalid_snapshot(error) from None
