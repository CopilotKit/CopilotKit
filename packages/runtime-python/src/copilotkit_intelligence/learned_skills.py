"""Safe learned-skill delivery errors and raw snapshot result shapes."""

import base64
import binascii
import re
from collections.abc import Sequence
from typing import Literal, NotRequired, TypeAlias, TypedDict, cast

LearnedSkillsErrorCode: TypeAlias = Literal[
    "INVALID_CONFIG",
    "AUTHENTICATION_FAILED",
    "AUTHORIZATION_FAILED",
    "ENTITLEMENT_REQUIRED",
    "DELIVERY_DISABLED",
    "CONTAINER_NOT_FOUND",
    "REVISION_NOT_FOUND",
    "REVISION_REVOKED",
    "NETWORK_ERROR",
    "TIMEOUT",
    "INVALID_SNAPSHOT",
    "UNSUPPORTED_SERVER",
]
_MESSAGES: dict[LearnedSkillsErrorCode, str] = {
    "INVALID_CONFIG": "Invalid learned-skills request configuration.",
    "AUTHENTICATION_FAILED": "Learned-skills authentication failed.",
    "AUTHORIZATION_FAILED": "Learned-skills access was denied.",
    "ENTITLEMENT_REQUIRED": "Learned-skills delivery requires an entitlement.",
    "DELIVERY_DISABLED": "Learned-skills delivery is disabled.",
    "CONTAINER_NOT_FOUND": "The learning container was not found.",
    "REVISION_NOT_FOUND": "The learned-skills revision was not found.",
    "REVISION_REVOKED": "The learned-skills revision was revoked.",
    "NETWORK_ERROR": "The learned-skills request failed during transport.",
    "TIMEOUT": "The learned-skills request timed out.",
    "INVALID_SNAPSHOT": "The learned-skills response metadata is invalid.",
    "UNSUPPORTED_SERVER": "The server returned an unsupported learned-skills response.",
}
_DENIAL_CODES = frozenset(
    {
        "AUTHENTICATION_FAILED",
        "AUTHORIZATION_FAILED",
        "ENTITLEMENT_REQUIRED",
        "DELIVERY_DISABLED",
        "CONTAINER_NOT_FOUND",
        "REVISION_NOT_FOUND",
        "REVISION_REVOKED",
    }
)


class LearnedSkillsError(Exception):
    """Stable safe failure; an optional cause is available for explicit diagnostics."""

    def __init__(
        self, code: LearnedSkillsErrorCode, retryable: bool, cause: BaseException | None = None
    ) -> None:
        self.code = code
        self.message = _MESSAGES[code]
        self.retryable = retryable
        self.cause = cause
        super().__init__(self.message)


class LearnedSkillsSnapshot(TypedDict):
    """Raw ZIP response; archive validation belongs to the framework adapter."""

    status: Literal["snapshot"]
    bytes: bytes
    revision: str
    etag: str
    contentType: str


class LearnedSkillsUnchanged(TypedDict):
    """Conditional response; the caller owns the previous snapshot."""

    status: Literal["unchanged"]
    revision: str
    etag: str


LearnedSkillsSnapshotResult: TypeAlias = LearnedSkillsSnapshot | LearnedSkillsUnchanged


def response_error(status: int, body: object) -> LearnedSkillsError:
    """Discard response text and preserve only recognized structured failure fields."""
    if status == 401:
        return LearnedSkillsError("AUTHENTICATION_FAILED", False)
    error = body.get("error") if isinstance(body, dict) else None
    if (
        isinstance(error, dict)
        and isinstance(error.get("code"), str)
        and error["code"] in _MESSAGES
        and isinstance(error.get("message"), str)
        and isinstance(error.get("category"), str)
        and isinstance(error.get("retryable"), bool)
    ):
        code = cast(LearnedSkillsErrorCode, error["code"])
        if status != 403 or code in _DENIAL_CODES:
            return LearnedSkillsError(code, error["retryable"])
    return LearnedSkillsError(
        "AUTHORIZATION_FAILED" if status == 403 else "UNSUPPORTED_SERVER", False
    )


class LearnedSkillsContainerRequest(TypedDict):
    """One source in a batch request."""

    containerId: str
    revision: NotRequired[str]
    ifNoneMatch: NotRequired[str]


LearnedSkillsBatchResult: TypeAlias = dict[str, LearnedSkillsSnapshotResult | LearnedSkillsError]


def validate_batch_request(
    containers: Sequence[LearnedSkillsContainerRequest],
) -> list[LearnedSkillsContainerRequest]:
    """Capture valid inputs before asynchronous transport starts."""
    if not isinstance(containers, (list, tuple)) or not 1 <= len(containers) <= 50:
        raise LearnedSkillsError("INVALID_CONFIG", False)
    copied: list[LearnedSkillsContainerRequest] = []
    seen: set[str] = set()
    for item in containers:
        if not isinstance(item, dict):
            raise LearnedSkillsError("INVALID_CONFIG", False)
        identifier = item.get("containerId")
        revision, etag = item.get("revision"), item.get("ifNoneMatch")
        if (
            not isinstance(identifier, str)
            or not identifier.strip()
            or identifier in seen
            or ("revision" in item and (not isinstance(revision, str) or not revision.strip()))
            or ("ifNoneMatch" in item and not _valid_etag(etag))
        ):
            raise LearnedSkillsError("INVALID_CONFIG", False)
        try:
            identifier.encode("utf-8", errors="strict")
        except UnicodeError as error:
            raise LearnedSkillsError("INVALID_CONFIG", False, error) from None
        seen.add(identifier)
        copied.append(cast(LearnedSkillsContainerRequest, dict(item)))
    return copied


def _valid_etag(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r'"[a-f0-9]{64}"', value) is not None


def _parse_batch_response(
    body: object, requested: Sequence[LearnedSkillsContainerRequest]
) -> LearnedSkillsBatchResult:
    """Reject the entire envelope before exposing any source result."""
    invalid = LearnedSkillsError("INVALID_SNAPSHOT", False)
    entries = body.get("containers") if isinstance(body, dict) else None
    if not isinstance(entries, list) or len(entries) != len(requested):
        raise invalid
    requests = {item["containerId"]: item for item in requested}
    results: LearnedSkillsBatchResult = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise invalid
        identifier = entry.get("containerId")
        if not isinstance(identifier, str) or identifier not in requests or identifier in results:
            raise invalid
        source = requests[identifier]
        status = entry.get("status")
        if status == "error":
            error = entry.get("error")
            if (
                not isinstance(error, dict)
                or not isinstance(error.get("code"), str)
                or error["code"] not in _MESSAGES
                or type(error.get("retryable")) is not bool
                or "bytesBase64" in entry
            ):
                raise invalid
            code = cast(LearnedSkillsErrorCode, error["code"])
            results[identifier] = LearnedSkillsError(code, error["retryable"])
            continue
        revision, etag = entry.get("revision"), entry.get("etag")
        if (
            not isinstance(revision, str)
            or not revision.strip()
            or not isinstance(etag, str)
            or not _valid_etag(etag)
            or ("revision" in source and revision != source["revision"])
        ):
            raise invalid
        if status == "unchanged":
            if source.get("ifNoneMatch") != etag or "bytesBase64" in entry:
                raise invalid
            results[identifier] = {"status": "unchanged", "revision": revision, "etag": etag}
        elif status == "snapshot":
            content_type, encoded = entry.get("contentType"), entry.get("bytesBase64")
            if (
                not isinstance(content_type, str)
                or content_type.split(";", 1)[0].strip().lower() != "application/zip"
                or not isinstance(encoded, str)
            ):
                raise invalid
            try:
                data = base64.b64decode(encoded, validate=True)
                if base64.b64encode(data).decode("ascii") != encoded:
                    raise invalid
            except (ValueError, binascii.Error):
                raise invalid from None
            results[identifier] = {
                "status": "snapshot",
                "revision": revision,
                "etag": etag,
                "contentType": content_type,
                "bytes": data,
            }
        else:
            raise invalid
    return results


def parse_batch_response(
    body: object, requested: Sequence[LearnedSkillsContainerRequest]
) -> LearnedSkillsBatchResult:
    """A malformed sibling cannot hide a recognized denial."""
    try:
        return _parse_batch_response(body, requested)
    except LearnedSkillsError:
        entries = body.get("containers") if isinstance(body, dict) else None
        identifiers = {source["containerId"] for source in requested}
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                identifier, error = entry.get("containerId"), entry.get("error")
                if (
                    isinstance(identifier, str)
                    and identifier in identifiers
                    and entry.get("status") == "error"
                    and isinstance(error, dict)
                    and isinstance(error.get("code"), str)
                    and error["code"] in _DENIAL_CODES
                ):
                    raise LearnedSkillsError(
                        cast(LearnedSkillsErrorCode, error["code"]), False
                    ) from None
        raise
