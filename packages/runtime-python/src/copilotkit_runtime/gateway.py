"""Phoenix ingestion with independent control reception and acknowledged delivery."""

import asyncio
import base64
import json
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import WebSocketException
from websockets.typing import Subprotocol

from .models import Json, RuntimeConfig
from .telemetry import Telemetry


class DeliveryRejected(ConnectionError):
    """A permanent gateway rejection cannot be repaired through transport retries."""


class Gateway:
    """One independent receiver and one ordered, bounded delivery lane per run."""

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
        self.supports_batch = False
        self.stop_requested = asyncio.Event()
        self._disconnected = asyncio.Event()
        self._reader: asyncio.Task[None] | None = None
        self._pending: dict[str, tuple[str, asyncio.Future[Json]]] = {}
        self.lock = asyncio.Lock()
        self._closed = False
        self._deliveries: set[asyncio.Task[None]] = set()

    async def join(self) -> None:
        """Wait for authenticated join, retrying only recoverable startup failures."""
        for attempt in range(self.config.max_delivery_attempts):
            try:
                await self._join_once()
                return
            except DeliveryRejected:
                await self._disconnect()
                raise
            except (ConnectionError, TimeoutError, OSError, WebSocketException):
                await self._disconnect()
                if attempt + 1 == self.config.max_delivery_attempts:
                    raise
                await asyncio.sleep(min(0.1 * 2**attempt, 2))

    async def _join_once(self) -> None:
        """Open a fresh socket, start its receiver, and negotiate batching capability."""
        if self._closed:
            raise DeliveryRejected("Gateway is closed")
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
            close_timeout=1,
            max_size=self.config.max_body_bytes,
        )
        self._disconnected.clear()
        self._reader = asyncio.create_task(
            self._receive(self.socket), name="copilotkit-gateway-receiver"
        )
        try:
            reply = await self._push(
                "phx_join", {"thread_id": self.thread_id, "run_id": self.run_id}
            )
            self.supports_batch = "runner_event_batch_v1" in reply.get("capabilities", [])
        except BaseException:
            await self._disconnect()
            raise

    async def _receive(self, socket: ClientConnection) -> None:
        """Read control frames while the agent is idle or a push waits for its ACK."""
        try:
            async for raw in socket:
                frame = json.loads(raw)
                if not isinstance(frame, list) or len(frame) != 5:
                    raise ConnectionError("Invalid Phoenix frame")
                _, ref, topic, event, payload = frame
                if event == "ag-ui" and topic == self.topic and isinstance(payload, dict):
                    if payload.get("type") == "CUSTOM" and payload.get("name") == "stop":
                        self.stop_requested.set()
                elif event == "phx_reply" and ref in self._pending:
                    expected_topic, future = self._pending[ref]
                    if topic == expected_topic and not future.done():
                        if not isinstance(payload, dict):
                            future.set_exception(ConnectionError("Invalid Phoenix reply"))
                        else:
                            future.set_result(payload)
                elif event in ("phx_close", "phx_error") and topic == self.topic:
                    raise ConnectionError("Phoenix channel closed")
        except (ValueError, ConnectionError, OSError, WebSocketException):
            pass
        finally:
            if self.socket is socket:
                self._disconnected.set()
                for _, future in self._pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("Gateway connection closed"))

    async def _push(self, event: str, payload: Json, topic: str | None = None) -> Json:
        """Match one reply reference without consuming another push's control messages."""
        if self.socket is None or self._disconnected.is_set():
            raise ConnectionError("Gateway is disconnected")
        self.ref += 1
        ref, target = str(self.ref), topic or self.topic
        if event == "phx_join":
            self.join_ref = ref
        future: asyncio.Future[Json] = asyncio.get_running_loop().create_future()
        self._pending[ref] = (target, future)
        try:
            async with asyncio.timeout(self.config.ack_timeout):
                await self.socket.send(
                    json.dumps([self.join_ref, ref, target, event, payload], allow_nan=False)
                )
                reply = await future
            response = reply.get("response", {})
            response = response if isinstance(response, dict) else {}
            if reply.get("status") != "ok":
                retryable = (
                    response.get("retryable") is True
                    or response.get("reason") == "gateway_draining"
                )
                if response.get("retryable") is False or (event == "phx_join" and not retryable):
                    raise DeliveryRejected("Phoenix push permanently rejected")
                raise ConnectionError("Phoenix push rejected")
            return response
        finally:
            self._pending.pop(ref, None)
            if future.done() and not future.cancelled():
                future.exception()
            else:
                future.cancel()

    async def send(self, event: Json) -> None:
        """Send one immutable event, with backpressure until its durable ACK."""
        await self.send_many([event])

    async def send_many(self, events: list[Json]) -> None:
        """Defer cancellation until the active immutable group reaches its ACK boundary."""
        detached: list[Json] = json.loads(json.dumps(events, allow_nan=False))
        task = asyncio.create_task(self._deliver(detached))
        self._deliveries.add(task)
        cancelled = False
        try:
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    # Each stop/lease cancellation must respect the same ACK boundary.
                    # Explicit abort() cancels the delivery itself, ending this loop.
                    cancelled = True
            task.result()
            if cancelled:
                raise asyncio.CancelledError
        finally:
            self._deliveries.discard(task)

    async def _deliver(self, events: list[Json]) -> None:
        """Stamp at most 32 events atomically and replay the same payloads after disconnect."""
        if not events or len(events) > 32:
            raise ValueError("Gateway batches require between 1 and 32 events")
        # send_many already detached and validated this snapshot.
        async with self.lock:
            if self.failed or self._closed:
                raise DeliveryRejected("Gateway delivery is unavailable")
            payloads = []
            for index, event in enumerate(events):
                if not isinstance(event, dict) or not isinstance(event.get("type"), str):
                    raise ValueError("Invalid AG-UI event")
                metadata = event.get("metadata") or {}
                if not isinstance(metadata, dict):
                    raise ValueError("Invalid event metadata")
                payloads.append(
                    {
                        **event,
                        "threadId": self.thread_id,
                        "runId": self.run_id,
                        "thread_id": self.thread_id,
                        "run_id": self.run_id,
                        "metadata": {
                            **metadata,
                            "cpki_event_id": str(uuid4()),
                            "cpki_event_seq": self.sequence + index + 1,
                        },
                    }
                )
            self.sequence += len(payloads)
            position = 0
            attempts = 0
            try:
                while position < len(payloads):
                    try:
                        if self.socket is None or self._disconnected.is_set():
                            await self._disconnect()
                            await self._join_once()
                        batch = (
                            payloads[position:]
                            if self.supports_batch
                            else payloads[position : position + 1]
                        )
                        await self._push(
                            "events" if self.supports_batch else "event",
                            {"events": batch} if self.supports_batch else batch[0],
                        )
                        position += len(batch)
                        attempts = 0
                    except DeliveryRejected:
                        raise
                    except (ConnectionError, TimeoutError, OSError, WebSocketException):
                        attempts += 1
                        await self._disconnect()
                        if attempts >= self.config.max_delivery_attempts:
                            raise ConnectionError("Event delivery retry budget exhausted")
                        await asyncio.sleep(min(0.1 * 2 ** (attempts - 1), 2))
            except BaseException:
                self.failed = True
                raise

    async def keepalive(self) -> None:
        """Reconnect idle channels and maintain Phoenix heartbeat frames without rerunning agents."""
        while not self._closed:
            try:
                await asyncio.wait_for(self._disconnected.wait(), timeout=15)
            except TimeoutError:
                pass
            async with self.lock:
                if self._closed:
                    return
                if self._disconnected.is_set():
                    await self._disconnect()
                    await self.join()
                else:
                    try:
                        await self._push("heartbeat", {}, "phoenix")
                    except (ConnectionError, TimeoutError, OSError, WebSocketException):
                        await self._disconnect()
                        await self.join()

    async def _disconnect(self) -> None:
        """Close one transport and settle its receiver before replacing it."""
        socket, reader = self.socket, self._reader
        self.socket = None
        self._reader = None
        if reader:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
        if socket:
            await socket.close()

    async def aclose(self) -> None:
        """Close only after delivery completes, or after a terminal failure/shutdown."""
        self._closed = True
        for task in self._deliveries:
            task.cancel()
        await self._disconnect()

    def abort(self) -> None:
        """Force-close transport at the host shutdown deadline; no ACK is claimed."""
        self._closed = self.failed = True
        for task in self._deliveries:
            task.cancel()
        if self._reader:
            self._reader.cancel()
        if self.socket:
            self.socket.transport.abort()
