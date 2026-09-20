"""Typed Runtime entitlement responses and strict platform normalization."""

import math
from typing import Any, Literal, NotRequired, TypedDict


class RuntimeEntitlement(TypedDict):
    """The Runtime grant and its platform-defined features and limits."""

    active: bool
    source: Literal[
        "managedOrgSubscription", "selfHostedDeploymentLicense", "awsMarketplaceDeploymentLicense"
    ]
    features: dict[str, bool]
    limits: dict[str, float]
    planCode: NotRequired[str]
    entitlementSource: NotRequired[str]


class RuntimeEntitlementProblem(TypedDict):
    """A structured reason why the platform cannot supply a ready grant."""

    code: str
    message: str
    retryable: bool
    requestId: NotRequired[str]
    traceId: NotRequired[str]


class RuntimeEntitlementReady(TypedDict):
    """A resolved grant. An inactive grant does not authorize Runtime access."""

    status: Literal["ready"]
    entitlement: RuntimeEntitlement


class RuntimeEntitlementUnavailable(TypedDict):
    """A non-ready platform result with retry and correlation details."""

    status: Literal["degraded", "misconfigured", "unavailable"]
    error: RuntimeEntitlementProblem


RuntimeEntitlementResponse = RuntimeEntitlementReady | RuntimeEntitlementUnavailable


def _finite_number(value: Any) -> bool:
    """Reject booleans and numbers outside the finite JavaScript number range."""
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _entitlement(value: Any) -> RuntimeEntitlement | None:
    """Reject malformed or unknown authority fields instead of widening a grant."""
    required = {"active", "source", "features", "limits"}
    if (
        not isinstance(value, dict)
        or not required <= value.keys()
        or value.keys() - required - {"planCode", "entitlementSource"}
    ):
        return None
    if type(value["active"]) is not bool or value["source"] not in (
        "managedOrgSubscription",
        "selfHostedDeploymentLicense",
        "awsMarketplaceDeploymentLicense",
    ):
        return None
    if not isinstance(value["features"], dict) or any(
        not isinstance(key, str) or type(flag) is not bool
        for key, flag in value["features"].items()
    ):
        return None
    if not isinstance(value["limits"], dict) or any(
        not isinstance(key, str) or not _finite_number(limit)
        for key, limit in value["limits"].items()
    ):
        return None
    result: RuntimeEntitlement = {
        "active": value["active"],
        "source": value["source"],
        "features": dict(value["features"]),
        "limits": dict(value["limits"]),
    }
    if "planCode" in value:
        if not isinstance(value["planCode"], str):
            return None
        result["planCode"] = value["planCode"]
    if "entitlementSource" in value:
        if not isinstance(value["entitlementSource"], str):
            return None
        result["entitlementSource"] = value["entitlementSource"]
    return result


def normalize_runtime_entitlements(value: Any) -> RuntimeEntitlementResponse | None:
    """Accept the current strict union or the legacy flat organization response."""
    if not isinstance(value, dict):
        return None
    if value.get("status") == "ready" and value.keys() == {"status", "entitlement"}:
        grant = _entitlement(value["entitlement"])
        return {"status": "ready", "entitlement": grant} if grant is not None else None
    if value.get("status") in ("degraded", "misconfigured", "unavailable") and value.keys() == {
        "status",
        "error",
    }:
        error = value["error"]
        required = {"code", "message", "retryable"}
        if (
            not isinstance(error, dict)
            or not required <= error.keys()
            or error.keys() - required - {"requestId", "traceId"}
        ):
            return None
        if (
            not isinstance(error["code"], str)
            or not isinstance(error["message"], str)
            or type(error["retryable"]) is not bool
        ):
            return None
        problem: RuntimeEntitlementProblem = {
            "code": error["code"],
            "message": error["message"],
            "retryable": error["retryable"],
        }
        if "requestId" in error:
            if not isinstance(error["requestId"], str):
                return None
            problem["requestId"] = error["requestId"]
        if "traceId" in error:
            if not isinstance(error["traceId"], str):
                return None
            problem["traceId"] = error["traceId"]
        return {"status": value["status"], "error": problem}
    if isinstance(value.get("organizationId"), str):
        grant = _entitlement({key: item for key, item in value.items() if key != "organizationId"})
        if grant is not None:
            return {"status": "ready", "entitlement": grant}
    return None
