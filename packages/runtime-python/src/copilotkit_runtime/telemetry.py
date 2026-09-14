"""Canonical CopilotKit analytics with bounded asynchronous delivery."""

import asyncio
import base64
import inspect
import json
import math
import os
import random
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, NoReturn
from urllib.parse import urlsplit

import httpx

from .models import Json

EventSink = Callable[[Json], Awaitable[None]]
_PREFIX = "oss.runtime."
_IDENTITY = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
# ECMAScript WhiteSpace + LineTerminator; Python str.strip() differs for FEFF/NEL.
_JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _invalid_json_constant(value: str) -> NoReturn:
    """Reject non-JSON numeric constants that Python's decoder otherwise accepts."""
    raise ValueError("Invalid JSON constant")


def _license_identity(token: str | None) -> str | None:
    """Read a safe legacy analytics claim, never verify a license or retain its token."""
    if not isinstance(token, str):
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", payload) or len(payload) % 4 == 1:
        return None
    try:
        decoded = json.loads(
            base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode(
                "utf-8", errors="replace"
            ),
            parse_constant=_invalid_json_constant,
        )
        value = decoded.get("telemetry_id") if isinstance(decoded, dict) else None
        if isinstance(value, str) and _IDENTITY.fullmatch(value.strip(" \t")):
            return value.strip(" \t")
    except (ValueError, TypeError, RecursionError):
        pass
    return None


@dataclass(frozen=True)
class TelemetryStats:
    """Local exporter diagnostics; these counters do not create analytics traffic."""

    queued: int
    sent: int
    failed: int
    dropped: int
    sampled_out: int


class Telemetry:
    """Sample canonical events and enqueue them without delaying request handling."""

    def __init__(
        self,
        enabled: bool = True,
        sink: EventSink | None = None,
        *,
        sample_rate: float = 0.05,
        telemetry_id: str | None = None,
        license_token: str | None = None,
        url: str = "https://telemetry.copilotkit.ai/ingest",
        queue_capacity: int = 256,
        timeout: float = 3,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.enabled = enabled and not any(
            os.getenv(key, "").lower() in ("true", "1")
            for key in ("DO_NOT_TRACK", "COPILOTKIT_TELEMETRY_DISABLED")
        )
        if sink is not None and not (
            inspect.iscoroutinefunction(sink)
            or inspect.iscoroutinefunction(getattr(sink, "__call__", None))
        ):
            raise ValueError("Telemetry sink must be async")
        override = os.getenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE")
        self.sample_rate = float(override) if override else sample_rate
        if not math.isfinite(self.sample_rate) or not 0 <= self.sample_rate <= 1:
            raise ValueError("Sample rate must be finite and between 0 and 1")
        if queue_capacity < 1 or not math.isfinite(timeout) or not 0 < timeout <= 3:
            raise ValueError("Telemetry queue must be positive and timeout within (0, 3] seconds")
        self.telemetry_id = next(
            (
                candidate.strip(" \t")
                for candidate in (telemetry_id, os.getenv("CPK_TELEMETRY_ID"))
                if isinstance(candidate, str) and _IDENTITY.fullmatch(candidate.strip(" \t"))
            ),
            None,
        )
        self.identified = False
        if self.telemetry_id is None:
            self.telemetry_id = _license_identity(
                next(
                    (
                        candidate
                        for candidate in (license_token, os.getenv("COPILOTKIT_LICENSE_TOKEN"))
                        if isinstance(candidate, str) and candidate.strip(_JS_WHITESPACE)
                    ),
                    None,
                )
            )
            self.identified = self.telemetry_id is not None
            if self.identified:
                self.sample_rate = 1
        self.url = os.getenv("COPILOTKIT_TELEMETRY_URL") or url
        parsed = urlsplit(self.url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
            raise ValueError("Invalid telemetry endpoint")
        self.sink = sink
        self.timeout = timeout
        self._queue: asyncio.Queue[Json] = asyncio.Queue(queue_capacity)
        self._worker: asyncio.Task[None] | None = None
        self._client = http_client
        self._owns_client = http_client is None
        self._closed = False
        self._sent = self._failed = self._dropped = self._sampled_out = 0

    @property
    def stats(self) -> TelemetryStats:
        """Return a snapshot of queue pressure and transport outcomes."""
        return TelemetryStats(
            self._queue.qsize(), self._sent, self._failed, self._dropped, self._sampled_out
        )

    async def emit(self, name: str, **attributes: Any) -> None:
        """Accept only canonical events and construct a fixed, content-free payload."""
        if not self.enabled or self._closed:
            return
        event = name.removeprefix(_PREFIX)
        properties: Json
        if event == "instance_created":
            count = attributes.get("agentsAmount", 0)
            properties = {
                "actionsAmount": 0,
                "endpointTypes": [],
                "endpointsAmount": 0,
                "agentsAmount": count if type(count) is int and count >= 0 else 0,
                "cloud.api_key_provided": False,
            }
        elif event == "copilot_request_created" and attributes.get("requestType") in (
            "run",
            "connect",
        ):
            properties = {
                "requestType": attributes["requestType"],
                "cloud.guardrails.enabled": False,
                "cloud.api_key_provided": False,
            }
        elif event in ("agent_execution_stream_started", "agent_execution_stream_ended"):
            properties = {}
        elif event == "agent_execution_stream_errored":
            properties = {
                "error": attributes.get("error")
                if attributes.get("error")
                in ("AGENT_EXECUTION_FAILED", "RUN_STOPPED", "GATEWAY_START_FAILED")
                else "AGENT_EXECUTION_FAILED"
            }
        else:
            return
        if self.sample_rate == 0 or random.random() >= self.sample_rate:
            self._sampled_out += 1
            return
        envelope = {
            "event": _PREFIX + event,
            "properties": properties,
            "ts": int(time.time()),
            "package": {"name": "copilotkit-intelligence-runtime", "version": "0.1.0"},
            "global_properties": {
                "sampleRate": self.sample_rate,
                "sampleRateAdjustmentFactor": 1 - self.sample_rate,
                "sampleWeight": 1 / self.sample_rate,
                "telemetry_identified": self.identified,
                "telemetry_emitter": "native-python",
                "telemetry_transport": "lambda",
            },
        }
        try:
            self._queue.put_nowait(envelope)
        except asyncio.QueueFull:
            self._dropped += 1
            return
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._drain(), name="copilotkit-telemetry")

    async def _drain(self) -> None:
        """Send one item at a time with bounded timeout and no automatic redirects."""
        while True:
            envelope = await self._queue.get()
            try:
                async with asyncio.timeout(self.timeout):
                    if self.sink:
                        await self.sink(envelope)
                    else:
                        if self._client is None:
                            self._client = httpx.AsyncClient(follow_redirects=False)
                        headers = {
                            "Content-Type": "application/json",
                            "User-Agent": "CopilotKit-Runtime/0.1.0 (copilotkit-intelligence-runtime)",
                        }
                        if self.telemetry_id:
                            headers["X-CopilotKit-Telemetry-Id"] = self.telemetry_id
                        response = await self._client.post(
                            self.url,
                            json=envelope,
                            headers=headers,
                            timeout=self.timeout,
                            follow_redirects=False,
                        )
                        response.raise_for_status()
                self._sent += 1
            except Exception:
                self._failed += 1
            finally:
                self._queue.task_done()

    async def flush(self, timeout: float = 3) -> bool:
        """Wait at most timeout seconds for the existing queue; return whether it drained."""
        try:
            async with asyncio.timeout(timeout):
                await self._queue.join()
            return True
        except TimeoutError:
            return False

    async def aclose(self, timeout: float = 3) -> None:
        """Stop accepting events and discard queued work after the shutdown deadline."""
        if self._closed:
            return
        self._closed = True
        await self.flush(timeout)
        if self._worker:
            self._worker.cancel()
            await asyncio.gather(self._worker, return_exceptions=True)
        while not self._queue.empty():
            self._queue.get_nowait()
            self._queue.task_done()
            self._dropped += 1
        if self._owns_client and self._client:
            await self._client.aclose()
