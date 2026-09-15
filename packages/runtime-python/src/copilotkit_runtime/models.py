"""Public configuration and trusted request identity."""

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

Json = dict[str, Any]


@dataclass(frozen=True)
class User:
    """Application user returned by the host's authentication callback."""

    id: str
    name: str = ""


@dataclass(frozen=True)
class RuntimeConfig:
    """Intelligence transport settings. Credentials never reach the browser."""

    api_key: str = field(repr=False)
    api_url: str = "https://api.intelligence.copilotkit.ai"
    runner_url: str = "wss://realtime.intelligence.copilotkit.ai/runner"
    client_url: str = "wss://realtime.intelligence.copilotkit.ai/client"
    base_path: str = "/copilotkit"
    request_timeout: float = 30
    ack_timeout: float = 10
    max_delivery_attempts: int = 5
    lock_ttl_seconds: int = 60
    lock_heartbeat_seconds: float = 20
    max_body_bytes: int = 2 * 1024 * 1024
    shutdown_timeout: float = 15
    allowed_origins: tuple[str, ...] = ()
    telemetry_enabled: bool = True

    def __post_init__(self) -> None:
        """Reject unusable credentials, URLs, and unbounded transport settings."""
        if not self.api_key.strip():
            raise ValueError("api_key is required")
        for value, schemes in [
            (self.api_url, ("http", "https")),
            (self.runner_url, ("ws", "wss")),
            (self.client_url, ("ws", "wss")),
        ]:
            parsed = urlsplit(value)
            if parsed.scheme not in schemes or not parsed.hostname or parsed.username:
                raise ValueError("Invalid Intelligence endpoint URL")
        if not self.base_path.startswith("/"):
            raise ValueError("base_path must start with /")
        if (
            min(
                self.request_timeout,
                self.ack_timeout,
                self.max_delivery_attempts,
                self.lock_ttl_seconds,
                self.lock_heartbeat_seconds,
                self.max_body_bytes,
                self.shutdown_timeout,
            )
            <= 0
        ):
            raise ValueError("Transport limits must be positive")
        if self.lock_heartbeat_seconds >= self.lock_ttl_seconds:
            raise ValueError("Heartbeat must precede lock expiry")


class RuntimeErrorResponse(Exception):
    """A sanitized HTTP failure safe to return to a runtime client."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class PlatformError(RuntimeErrorResponse):
    """Intelligence returned a non-success status or invalid response."""
