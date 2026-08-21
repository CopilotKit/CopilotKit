"""Value-free guard helpers for keeping Cloudplot simulation-only.

The functions intentionally return only event classes and opaque subjects. They
do not read credentials, AWS config files, or metadata endpoints.
"""

from __future__ import annotations

import hashlib
import builtins
import io
import os
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

FORBIDDEN_HOST_FRAGMENTS = (
    "amazonaws.com",
    "aws.amazon.com",
    "169.254.169.254",
    "fd00:ec2::254",
)

FORBIDDEN_CREDENTIAL_VARIABLES = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_CONFIG_FILE",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
)

FORBIDDEN_SIGNING_FRAGMENTS = ("sigv4", "aws4", "credential-provider")


@dataclass(frozen=True)
class NoAwsGuardEvent:
    """A redacted event emitted by the simulation boundary."""

    event_class: str
    subject_digest: str


def _digest(subject: str) -> str:
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()


def classify_aws_boundary(subject: str) -> NoAwsGuardEvent | None:
    """Classify a host/env/signing subject without returning plaintext secrets."""

    normalized = subject.lower()
    for host_fragment in FORBIDDEN_HOST_FRAGMENTS:
        if host_fragment in normalized:
            return NoAwsGuardEvent("forbidden-host", _digest(host_fragment))

    for signing_fragment in FORBIDDEN_SIGNING_FRAGMENTS:
        if signing_fragment in normalized:
            return NoAwsGuardEvent("forbidden-signing", _digest(signing_fragment))

    if subject in FORBIDDEN_CREDENTIAL_VARIABLES:
        return NoAwsGuardEvent("forbidden-credential-variable", _digest(subject))

    return None


def assert_no_aws_boundary(subject: str) -> None:
    """Raise if a subject would cross the approved no-AWS simulation boundary."""

    event = classify_aws_boundary(subject)
    if event is not None:
        raise RuntimeError(f"Cloudplot simulation attempted {event.event_class}")


def assert_environment_has_no_aws_credentials() -> None:
    """Fail if AWS credential-provider environment variables are present."""

    for variable_name in FORBIDDEN_CREDENTIAL_VARIABLES:
        if variable_name in os.environ:
            raise RuntimeError("Cloudplot simulation attempted forbidden-credential-variable")


def _assert_no_aws_file_path(file: object) -> None:
    if isinstance(file, int):
        return

    normalized = str(Path(os.fspath(file)).expanduser()).lower().replace("\\", "/")
    if normalized.endswith("/.aws/credentials") or normalized.endswith("/.aws/config"):
        raise RuntimeError("Cloudplot simulation attempted forbidden-credential-file")


def install_no_aws_guard() -> Callable[[], None]:
    """Install process-wide deny hooks and return an idempotent restore callback.

    The guard never reads credential values. It blocks AWS DNS/socket targets and
    the two shared credential-provider files before the underlying operation runs.
    """

    assert_environment_has_no_aws_credentials()

    original_getaddrinfo = socket.getaddrinfo
    original_create_connection = socket.create_connection
    original_builtin_open = builtins.open
    original_io_open = io.open
    restored = False

    def guarded_getaddrinfo(host: object, *args: Any, **kwargs: Any):
        assert_no_aws_boundary(str(host))
        return original_getaddrinfo(host, *args, **kwargs)

    def guarded_create_connection(address: object, *args: Any, **kwargs: Any):
        host = address[0] if isinstance(address, tuple) and address else address
        assert_no_aws_boundary(str(host))
        return original_create_connection(address, *args, **kwargs)

    def guarded_builtin_open(file: object, *args: Any, **kwargs: Any):
        _assert_no_aws_file_path(file)
        return original_builtin_open(file, *args, **kwargs)

    def guarded_io_open(file: object, *args: Any, **kwargs: Any):
        _assert_no_aws_file_path(file)
        return original_io_open(file, *args, **kwargs)

    socket.getaddrinfo = guarded_getaddrinfo
    socket.create_connection = guarded_create_connection
    builtins.open = guarded_builtin_open
    io.open = guarded_io_open

    def restore() -> None:
        nonlocal restored
        if restored:
            return
        socket.getaddrinfo = original_getaddrinfo
        socket.create_connection = original_create_connection
        builtins.open = original_builtin_open
        io.open = original_io_open
        restored = True

    return restore
