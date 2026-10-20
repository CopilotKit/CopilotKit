"""Typed, sanitized Inspector metadata from the Intelligence project."""

from typing import Literal, NotRequired, TypedDict
from urllib.parse import unquote, urlsplit

import httpx


class InspectorIdentity(TypedDict):
    """Project and organization display names."""

    organizationName: str
    projectName: str


class InspectorPlan(TypedDict):
    """The plan identifier and display label."""

    code: str
    label: str


class InspectorLicense(TypedDict):
    """The displayed license state, not an authorization grant."""

    state: Literal["valid", "none", "expired", "unknown"]


class InspectorAction(TypedDict):
    """A plan action with a URL that excludes credentials, queries, and fragments."""

    kind: Literal["manage_plan", "renew", "enable_intelligence"]
    url: str


class InspectorFiniteLimit(TypedDict):
    """A positive, finite usage limit."""

    kind: Literal["finite"]
    value: int


class InspectorUnlimitedLimit(TypedDict):
    """A plan with no finite usage limit."""

    kind: Literal["unlimited"]


class InspectorUnknownLimit(TypedDict):
    """A plan whose usage limit is not available."""

    kind: Literal["unknown"]


InspectorUsageLimit = InspectorFiniteLimit | InspectorUnlimitedLimit | InspectorUnknownLimit


class InspectorUsage(TypedDict):
    """Usage counts and the plan limit."""

    used: int
    limit: InspectorUsageLimit
    expiringSoonCount: NotRequired[int]


class InspectorMetadata(TypedDict):
    """Version 1 metadata with independent optional display modules."""

    schemaVersion: Literal[1]
    identity: NotRequired[InspectorIdentity]
    plan: NotRequired[InspectorPlan]
    license: NotRequired[InspectorLicense]
    action: NotRequired[InspectorAction]
    usage: NotRequired[InspectorUsage]


def _text(value: object) -> str | None:
    """Trim the ECMAScript whitespace set used by the TypeScript parser."""
    if not isinstance(value, str):
        return None
    return (
        value.strip(
            "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
            "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
            "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
        )
        or None
    )


def _integer(value: object, minimum: int = 0) -> int | None:
    """Accept only JSON numbers within JavaScript's safe integer range."""
    if type(value) not in (int, float):
        return None
    if (
        isinstance(value, (int, float))
        and minimum <= value <= 9007199254740991
        and value == int(value)
    ):
        return int(value)
    return None


def _action_url(value: object) -> str | None:
    """Permit HTTPS and loopback HTTP links without embedded private parameters."""
    url = _text(value)
    if url is None or "?" in url or "#" in url or "://" not in url:
        return None
    authority = url.split("://", 1)[1].split("/", 1)[0]
    if "@" in authority:
        return None
    try:
        # Browsers treat backslashes as path separators in HTTP(S) URLs.
        candidate = url.replace("\\", "/")
        structural = urlsplit(candidate)
        structural.port  # Reject malformed and out-of-range ports.
        parsed = httpx.URL(candidate)
        host = unquote(parsed.host, errors="strict")
    except (httpx.InvalidURL, ValueError, UnicodeError):
        return None
    if (
        not host
        or parsed.userinfo
        or any(character in host for character in "\x00\t\n\r #%/<>?@[\\]^|")
    ):
        return None
    if parsed.scheme == "https" or (
        parsed.scheme == "http" and parsed.host in ("localhost", "127.0.0.1", "::1")
    ):
        return url
    return None


def parse_inspector_metadata(value: object) -> InspectorMetadata | None:
    """Copy supported fields without letting one invalid module hide valid modules."""
    if (
        not isinstance(value, dict)
        or type(value.get("schemaVersion")) not in (int, float)
        or value.get("schemaVersion") != 1
    ):
        return None
    result: InspectorMetadata = {"schemaVersion": 1}
    identity = value.get("identity")
    if isinstance(identity, dict):
        organization = _text(identity.get("organizationName"))
        project = _text(identity.get("projectName"))
        if organization is not None and project is not None:
            result["identity"] = {"organizationName": organization, "projectName": project}
    plan = value.get("plan")
    if isinstance(plan, dict):
        code, label = _text(plan.get("code")), _text(plan.get("label"))
        if code is not None and label is not None:
            result["plan"] = {"code": code, "label": label}
    license = value.get("license")
    if isinstance(license, dict):
        state = license.get("state")
        if state in ("valid", "none", "expired", "unknown"):
            result["license"] = {"state": state}
    action = value.get("action")
    if isinstance(action, dict):
        kind, url = action.get("kind"), _action_url(action.get("url"))
        if kind in ("manage_plan", "renew", "enable_intelligence") and url is not None:
            result["action"] = {"kind": kind, "url": url}
    usage = value.get("usage")
    if isinstance(usage, dict):
        used, limit = _integer(usage.get("used")), usage.get("limit")
        if used is not None and isinstance(limit, dict):
            parsed_limit: InspectorUsageLimit | None = None
            if limit.get("kind") == "finite":
                count = _integer(limit.get("value"), 1)
                if count is not None:
                    parsed_limit = {"kind": "finite", "value": count}
            elif limit.get("kind") == "unlimited":
                parsed_limit = {"kind": "unlimited"}
            elif limit.get("kind") == "unknown":
                parsed_limit = {"kind": "unknown"}
            if parsed_limit is not None:
                result["usage"] = {"used": used, "limit": parsed_limit}
                expiring = _integer(usage.get("expiringSoonCount"))
                if expiring is not None:
                    result["usage"]["expiringSoonCount"] = expiring
    return result
