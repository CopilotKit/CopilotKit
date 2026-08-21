from __future__ import annotations

import builtins
import socket
from pathlib import Path

import pytest

from no_aws_guard import (
    assert_environment_has_no_aws_credentials,
    assert_no_aws_boundary,
    classify_aws_boundary,
    install_no_aws_guard,
)


AGENT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = AGENT_ROOT.parent


@pytest.mark.parametrize(
    ("subject", "event_class"),
    [
        ("https://s3.amazonaws.com/example", "forbidden-host"),
        ("https://console.aws.amazon.com", "forbidden-host"),
        ("http://169.254.169.254/latest/meta-data", "forbidden-host"),
        ("fd00:ec2::254", "forbidden-host"),
        ("AWS_ACCESS_KEY_ID", "forbidden-credential-variable"),
        ("AWS_SECRET_ACCESS_KEY", "forbidden-credential-variable"),
        ("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "forbidden-credential-variable"),
        ("credential-provider-node", "forbidden-signing"),
        ("SigV4 signer", "forbidden-signing"),
    ],
)
def test_no_aws_guard_classifies_forbidden_boundaries(subject: str, event_class: str) -> None:
    event = classify_aws_boundary(subject)

    assert event is not None
    assert event.event_class == event_class
    assert subject not in event.subject_digest


@pytest.mark.parametrize(
    "subject",
    [
        "https://api.openai.com/v1/responses",
        "https://api.smith.langchain.com",
        "https://cloudplot-frontend.railway.app",
    ],
)
def test_no_aws_guard_allows_approved_simulation_boundaries(subject: str) -> None:
    assert_no_aws_boundary(subject)


def test_environment_credential_provider_variables_are_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "redacted-test-value")

    with pytest.raises(RuntimeError, match="forbidden-credential-variable"):
        assert_environment_has_no_aws_credentials()


def test_installed_guard_denies_dns_socket_and_aws_config_file_access() -> None:
    restore = install_no_aws_guard()
    try:
        with pytest.raises(RuntimeError, match="forbidden-host"):
            socket.getaddrinfo("s3.amazonaws.com", 443)
        with pytest.raises(RuntimeError, match="forbidden-host"):
            socket.create_connection(("169.254.169.254", 80))
        with pytest.raises(RuntimeError, match="forbidden-credential-file"):
            builtins.open(Path.home() / ".aws" / "credentials")
    finally:
        restore()


def test_cloudplot_runtime_has_no_aws_sdk_imports() -> None:
    forbidden = ("boto3", "botocore", "@aws-sdk")
    checked_files = [
        AGENT_ROOT / "main.py",
        FRONTEND_ROOT / "src/hooks/useFrontendTools.tsx",
        FRONTEND_ROOT / "src/hooks/useInfraApproval.tsx",
    ]

    for path in checked_files:
        content = path.read_text()
        for token in forbidden:
            assert token not in content, f"{path.relative_to(FRONTEND_ROOT)} contains forbidden AWS SDK token {token}"
