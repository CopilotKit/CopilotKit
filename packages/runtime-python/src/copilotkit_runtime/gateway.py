"""Phoenix ingestion with bounded, acknowledged, stable-ID delivery."""

import asyncio
import base64
import json
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import WebSocketException
from websockets.typing import Subprotocol

from .models import Json, RuntimeConfig
from .telemetry import Telemetry


class DeliveryRejected(ConnectionError):
    """The gateway rejected an event permanently; retrying cannot fix its scope."""


class Gateway:
    """One ordered channel per run; awaiting ACK provides natural backpressure."""

    def __init__(
        self, config: RuntimeConfig, thread_id: str, run_id: str, telemetry: Telemetry
    ) -> None:
        self.config = config
        self.thread_id = thread_id
        self.run_id = run_id
        self.telemetry = telemetry
        self.topic = f"ingestion:{run_id}"
        self.socket: ClientConnection | None = None
        self.ref = 0
        self.join_ref = ""
        self.sequence = 0
        self.failed = False
        self.lock = asyncio.Lock()
        self.heartbeat: asyncio.Task[None] | None = None

    async def join(self) -> None:
        """Authenticate the socket and wait for the ingestion channel join reply."""
        parts = urlsplit(self.config.runner_url)
        path = parts.path.rstrip("/")
        if not path.endswith("/websocket"):
            path += "/websocket"
        query = dict(parse_qsl(parts.query))
        query["vsn"] = "2.0.0"
        url = urlunsplit((parts.scheme, parts.netloc, path, urlencode(query), ""))
        token = base64.b64encode(self.config.api_key.encode()).decode().rstrip("=")
        self.socket = await connect(
            url,
            subprotocols=[Subprotocol("phoenix"), Subprotocol("base64url.bearer.phx." + token)],
            open_timeout=self.config.ack_timeout,
            close_timeout=2,
            max_size=self.config.max_body_bytes,
        )
        self.ref += 1
        self.join_ref = str(self.ref)
        try:
            await self._push("phx_join", {"thread_id": self.thread_id, "run_id": self.run_id})
        except BaseException:
            await self.socket.close()
            self.socket = None
            raise

    async def _push(self, event: str, payload: Json, topic: str | None = None) -> None:
        """Match reply references under one lock so stale ACKs cannot drop events."""
        if self.socket is None:
            raise ConnectionError("Gateway is disconnected")
        self.ref += 1
        ref = str(self.ref)
        if event == "phx_join":
            self.join_ref = ref
        target = topic or self.topic
        await self.socket.send(json.dumps([self.join_ref, ref, target, event, payload]))
        async with asyncio.timeout(self.config.ack_timeout):
            while True:
                message = json.loads(await self.socket.recv())
                if not isinstance(message, list) or len(message) != 5:
                    raise ConnectionError("Invalid Phoenix frame")
                if message[3] in ("phx_error", "phx_close"):
                    raise ConnectionError("Phoenix channel closed")
                if message[1] == ref and message[2] == target and message[3] == "phx_reply":
                    if message[4].get("status") != "ok":
                        if message[4].get("response", {}).get("retryable") is False:
                            raise DeliveryRejected("Phoenix push permanently rejected")
                        raise ConnectionError("Phoenix push rejected")
                    return

    async def send(self, event: Json) -> None:
        """Stamp canonical ownership once, retrying the same event until acknowledged."""
        if self.failed:
            raise DeliveryRejected("Gateway delivery has already failed")
        self.sequence += 1
        payload = {
            **event,
            "threadId": self.thread_id,
            "runId": self.run_id,
            "thread_id": self.thread_id,
            "run_id": self.run_id,
            "metadata": {
                **(event.get("metadata") or {}),
                "cpki_event_id": str(uuid4()),
                "cpki_event_seq": self.sequence,
            },
        }
        started = time.monotonic()
        async with self.lock:
            for attempt in range(self.config.max_delivery_attempts):
                try:
                    if self.socket is None:
                        await self.join()
                    await self._push("event", payload)
                    await self.telemetry.emit(
                        "runtime.event.acknowledged",
                        event_count=1,
                        duration_ms=(time.monotonic() - started) * 1000,
                    )
                    return
                except DeliveryRejected:
                    self.failed = True
                    raise
                except (ConnectionError, TimeoutError, OSError, WebSocketException) as error:
                    await self.telemetry.emit(
                        "runtime.event.retry", attempt=attempt + 1, queue_depth=1
                    )
                    if self.socket:
                        await self.socket.close()
                        self.socket = None
                    if attempt + 1 == self.config.max_delivery_attempts:
                        self.failed = True
                        raise ConnectionError("Event delivery retry budget exhausted") from error
                    await asyncio.sleep(min(0.1 * 2**attempt, 2))

    async def keepalive(self) -> None:
        """Maintain Phoenix application heartbeats while an agent is producing slowly."""
        while True:
            await asyncio.sleep(15)
            async with self.lock:
                await self._push("heartbeat", {}, "phoenix")

    async def aclose(self) -> None:
        """Close the run socket after all acknowledged writes or a terminal failure."""
        if self.socket:
            await self.socket.close()
            self.socket = None
