"""Safe learned-skill delivery errors and raw snapshot result shapes."""

from typing import Literal, TypeAlias, TypedDict, cast

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
