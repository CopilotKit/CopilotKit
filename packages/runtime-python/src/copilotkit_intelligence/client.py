"""Runtime-independent, asynchronous Intelligence API client."""

import asyncio
import json
import logging
import math
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from time import monotonic as _entitlement_now
from types import TracebackType
from typing import Any, Literal, Self, cast
from urllib.parse import quote, unquote, urlsplit
from uuid import uuid4

import httpx

from .entitlements import RuntimeEntitlementResponse, normalize_runtime_entitlements
from .inspector import InspectorMetadata, parse_inspector_metadata
from .resources import (
    AnnotateResponse,
    ListMemoriesResponse,
    ListThreadsResponse,
    RecallMemoriesResponse,
    SaveMemoryResponse,
    ThreadEventsResponse,
    ThreadMessagesResponse,
    ThreadResolution,
    ThreadStateResponse,
    ThreadSummary,
)

Json = dict[str, Any]
Access = Literal["none", "read", "read-write"]
ThreadListener = Callable[[Json], None]
logger = logging.getLogger(__name__)
_INSPECTOR_METADATA_TIMEOUT = 5.0


class IntelligenceError(Exception):
    """A safe platform failure with its HTTP status and no response-body disclosure."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class RuntimeEntitlementError(IntelligenceError):
    """A safe entitlement request failure with HTTP status and retry guidance."""

    def __init__(self, status: int, message: str, retryable: bool) -> None:
        super().__init__(status, message)
        self.retryable = retryable


@dataclass(frozen=True)
class MemoryGrant:
    """Trusted application limits for user and project memories."""

    user: Access
    project: Access

    def __post_init__(self) -> None:
        """Reject unknown permissions instead of delegating an invalid grant."""
        if self.user not in ("none", "read", "read-write") or self.project not in (
            "none",
            "read",
            "read-write",
        ):
            raise ValueError("Invalid memory grant")


def segment(value: str) -> str:
    """Encode a nonempty opaque identifier as one URL path segment."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("A nonempty identifier is required")
    return quote(value, safe="")


class Intelligence:
    """Call Intelligence from scripts, workers, or a Runtime with one pooled client.

    The client has no ASGI dependency or agent requirement.
    Its async context manager closes only an HTTP client that it created.
    Writes are never retried automatically. Cancellation propagates to httpx.
    """

    def __init__(
        self,
        *,
        api_key: str,
        api_url: str = "https://api.intelligence.copilotkit.ai",
        runner_url: str = "wss://realtime.intelligence.copilotkit.ai/runner",
        client_url: str = "wss://realtime.intelligence.copilotkit.ai/client",
        request_timeout: float = 30,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("api_key is required")
        for endpoint, schemes in (
            (api_url, ("http", "https")),
            (runner_url, ("ws", "wss")),
            (client_url, ("ws", "wss")),
        ):
            parsed = urlsplit(endpoint)
            if (
                parsed.scheme not in schemes
                or not parsed.hostname
                or parsed.username
                or parsed.fragment
                or parsed.query
            ):
                raise ValueError("Invalid Intelligence endpoint URL")
        if not math.isfinite(request_timeout) or request_timeout <= 0:
            raise ValueError("request_timeout must be positive and finite")
        self.api_key = api_key
        self.api_url = api_url.rstrip("/")
        self.runner_url = runner_url
        self.client_url = client_url
        self.request_timeout = request_timeout
        self.http_client = http_client or httpx.AsyncClient()
        self._owns_http_client = http_client is None
        self._entitlements_task: asyncio.Task[RuntimeEntitlementResponse] | None = None
        self._entitlements_waiters = 0
        self._entitlements_cache: (
            tuple[float, RuntimeEntitlementResponse | RuntimeEntitlementError] | None
        ) = None
        self._listeners: dict[str, list[ThreadListener]] = {
            "created": [],
            "updated": [],
            "deleted": [],
        }

    async def __aenter__(self) -> Self:
        """Use this client within an asynchronous context."""
        return self

    def on_thread_created(self, callback: ThreadListener) -> Callable[[], None]:
        """Register a synchronous creation listener and return its unsubscribe function."""
        return self._subscribe("created", callback)

    def on_thread_updated(self, callback: ThreadListener) -> Callable[[], None]:
        """Register a synchronous update or archive listener."""
        return self._subscribe("updated", callback)

    def on_thread_deleted(self, callback: ThreadListener) -> Callable[[], None]:
        """Register a synchronous deletion listener with the explicit caller identity."""
        return self._subscribe("deleted", callback)

    def _subscribe(self, event: str, callback: ThreadListener) -> Callable[[], None]:
        """Keep registration order and make repeated unsubscribe calls harmless."""
        if not callable(callback):
            raise TypeError("A thread listener must be callable")
        if not any(listener is callback for listener in self._listeners[event]):
            self._listeners[event].append(callback)

        def unsubscribe() -> None:
            self._listeners[event] = [
                listener for listener in self._listeners[event] if listener is not callback
            ]

        return unsubscribe

    def _notify_thread_mutation(
        self, method: str, path: str, body: Json | None, result: Any
    ) -> None:
        """Notify SDK and Runtime mutations once, excluding locks and subscriptions."""
        prefix = "/api/threads/"
        thread_path = path.startswith(prefix) and "/" not in path[len(prefix) :]
        event = None
        payload = None
        if (method == "POST" and path == "/api/threads") or (method == "PATCH" and thread_path):
            thread = result.get("thread") if isinstance(result, dict) else None
            if isinstance(thread, dict) and isinstance(thread.get("id"), str):
                event = "created" if method == "POST" else "updated"
                payload = thread
        elif method == "DELETE" and thread_path and body is not None:
            if isinstance(body.get("userId"), str) and isinstance(body.get("agentId"), str):
                event = "deleted"
                payload = {
                    "threadId": unquote(path[len(prefix) :]),
                    "userId": body["userId"],
                    "agentId": body["agentId"],
                }
        if event is None or payload is None:
            return
        for callback in tuple(self._listeners[event]):
            try:
                callback(payload)
            except Exception:
                logger.exception("Intelligence thread %s listener failed", event)

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Release the owned HTTP pool after the context exits."""
        await self.aclose()

    async def aclose(self) -> None:
        """Close the owned HTTP client; a supplied client stays usable."""
        task = self._entitlements_task
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._entitlements_cache = None
        if self._owns_http_client:
            await self.http_client.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        body: Json | None = None,
        query: Json | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        """Share authenticated transport with Runtime without exposing browser routes."""
        try:
            response = await self.http_client.request(
                method,
                self.api_url + path,
                json=body,
                params=query,
                headers={
                    **(headers or {}),
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=self.request_timeout,
                follow_redirects=False,
            )
        except httpx.HTTPError as error:
            raise IntelligenceError(502, "Intelligence connection failed") from error
        if not 200 <= response.status_code < 300:
            raise IntelligenceError(response.status_code, "Intelligence request rejected")
        result = None
        if response.content:
            try:
                result = response.json()
            except ValueError as error:
                raise IntelligenceError(502, "Invalid Intelligence response") from error
        self._notify_thread_mutation(method, path, body, result)
        return result

    async def _object(
        self,
        method: str,
        path: str,
        body: Json | None = None,
        query: Json | None = None,
        headers: dict[str, str] | None = None,
    ) -> Json:
        """Reject empty or non-object responses before returning a resource."""
        result = await self._request(method, path, body, query, headers)
        if not isinstance(result, dict):
            raise IntelligenceError(502, "Invalid Intelligence response")
        return result

    @staticmethod
    def _memory_headers(user_id: str, grant: MemoryGrant | None) -> dict[str, str]:
        """Attribute memory operations to a bare customer user, not an API-key creator."""
        segment(user_id)
        headers = {"x-cpki-user-id": user_id}
        if grant is not None:
            if not isinstance(grant, MemoryGrant):
                raise ValueError("memory_grant must be a MemoryGrant")
            headers["x-cpki-memory-grant"] = json.dumps(
                {"user": grant.user, "project": grant.project}, separators=(",", ":")
            )
        return headers

    async def get_inspector_metadata(self) -> InspectorMetadata | None:
        """Read sanitized project metadata within five seconds, or a shorter client deadline.

        A 204, 404, or unsupported schema returns None. Other provider failures
        raise IntelligenceError. Cancellation propagates and a deadline raises TimeoutError.
        """
        deadline = min(self.request_timeout, _INSPECTOR_METADATA_TIMEOUT)
        try:
            async with asyncio.timeout(deadline):
                async with self.http_client.stream(
                    "GET",
                    self.api_url + "/api/inspector/metadata",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    timeout=deadline,
                    follow_redirects=False,
                ) as response:
                    if response.status_code in (204, 404):
                        return None
                    if not 200 <= response.status_code < 300:
                        raise IntelligenceError(
                            response.status_code, "Intelligence request rejected"
                        )
                    await response.aread()
                    try:
                        decoded = response.json()
                    except ValueError:
                        raise IntelligenceError(
                            502, "Invalid Inspector metadata response"
                        ) from None
                    return parse_inspector_metadata(decoded)
        except (TimeoutError, httpx.TimeoutException):
            raise TimeoutError("Inspector metadata request timed out") from None
        except httpx.HTTPError:
            raise IntelligenceError(502, "Intelligence connection failed") from None

    async def get_runtime_entitlements(self) -> RuntimeEntitlementResponse:
        """Share concurrent lookups and return copies of fresh cached results."""
        cached = self._entitlements_cache
        if cached is not None and _entitlement_now() < cached[0]:
            value = cached[1]
            if isinstance(value, RuntimeEntitlementError):
                raise RuntimeEntitlementError(value.status, str(value), value.retryable) from None
            return deepcopy(value)
        task = self._entitlements_task
        if task is None:
            task = asyncio.create_task(self._load_runtime_entitlements())
            self._entitlements_task = task
        self._entitlements_waiters += 1
        try:
            return deepcopy(await asyncio.shield(task))
        except RuntimeEntitlementError as error:
            raise RuntimeEntitlementError(error.status, str(error), error.retryable) from None
        finally:
            self._entitlements_waiters -= 1
            if self._entitlements_task is task and (task.done() or self._entitlements_waiters == 0):
                self._entitlements_task = None
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

    async def _load_runtime_entitlements(self) -> RuntimeEntitlementResponse:
        """Cache completed lookups without extending expired Runtime authority."""
        try:
            response = await self._fetch_runtime_entitlements()
        except RuntimeEntitlementError as error:
            self._entitlements_cache = (_entitlement_now() + 5, error)
            raise
        active = response["status"] == "ready" and response["entitlement"]["active"]
        self._entitlements_cache = (_entitlement_now() + (30 if active else 5), response)
        return response

    async def _fetch_runtime_entitlements(self) -> RuntimeEntitlementResponse:
        """Make one bounded entitlement request without redirects or retries."""
        deadline = min(self.request_timeout, 1.5)
        try:
            async with asyncio.timeout(deadline):
                async with self.http_client.stream(
                    "GET",
                    self.api_url + "/api/entitlements/runtime",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=deadline,
                    follow_redirects=False,
                ) as response:
                    status = response.status_code
                    if not 200 <= status < 300:
                        raise RuntimeEntitlementError(
                            status,
                            "Runtime entitlement request rejected",
                            status in (408, 425, 429) or status >= 500,
                        )
                    await response.aread()
                    try:
                        normalized = normalize_runtime_entitlements(response.json())
                    except ValueError:
                        normalized = None
                    if normalized is None:
                        raise RuntimeEntitlementError(
                            502, "Invalid Runtime entitlement response", False
                        )
                    return normalized
        except (TimeoutError, httpx.TimeoutException):
            raise RuntimeEntitlementError(
                504, "Runtime entitlement request timed out", True
            ) from None
        except RuntimeEntitlementError as error:
            raise RuntimeEntitlementError(
                error.status, "Runtime entitlement request failed", error.retryable
            ) from None
        except Exception:
            raise RuntimeEntitlementError(
                502, "Runtime entitlement connection failed", True
            ) from None

    async def list_memories(
        self,
        *,
        user_id: str,
        memory_grant: MemoryGrant | None = None,
        include_invalidated: bool = False,
    ) -> ListMemoriesResponse:
        """List memories; include retired entries only when requested."""
        return cast(
            ListMemoriesResponse,
            await self._object(
                "GET",
                "/api/memories",
                query={"includeInvalidated": "true"} if include_invalidated else None,
                headers=self._memory_headers(user_id, memory_grant),
            ),
        )

    async def create_memory(
        self,
        *,
        user_id: str,
        content: str,
        kind: str,
        scope: str | None = None,
        source_thread_ids: list[str] | None = None,
        memory_grant: MemoryGrant | None = None,
    ) -> SaveMemoryResponse:
        """Save a memory, retaining the platform's absorbed marker."""
        body: Json = {"content": content, "kind": kind, "sourceThreadIds": source_thread_ids or []}
        if scope is not None:
            body["scope"] = scope
        return cast(
            SaveMemoryResponse,
            await self._object(
                "POST", "/api/memories", body, headers=self._memory_headers(user_id, memory_grant)
            ),
        )

    async def update_memory(
        self,
        *,
        user_id: str,
        memory_id: str,
        content: str,
        kind: str,
        scope: str | None = None,
        source_thread_ids: list[str] | None = None,
        memory_grant: MemoryGrant | None = None,
    ) -> SaveMemoryResponse:
        """Supersede a memory and return its replacement and retired ID."""
        body: Json = {"content": content, "kind": kind, "sourceThreadIds": source_thread_ids or []}
        if scope is not None:
            body["scope"] = scope
        return cast(
            SaveMemoryResponse,
            await self._object(
                "PATCH",
                "/api/memories/" + segment(memory_id),
                body,
                headers=self._memory_headers(user_id, memory_grant),
            ),
        )

    async def remove_memory(
        self, *, user_id: str, memory_id: str, memory_grant: MemoryGrant | None = None
    ) -> None:
        """Retire a memory without deleting its history."""
        await self._request(
            "DELETE",
            "/api/memories/" + segment(memory_id),
            headers=self._memory_headers(user_id, memory_grant),
        )

    async def recall_memories(
        self,
        *,
        user_id: str,
        query: str,
        limit: int | None = None,
        scope: str | None = None,
        memory_grant: MemoryGrant | None = None,
    ) -> RecallMemoriesResponse:
        """Recall relevant memories with the platform's relevance scores."""
        body: Json = {"query": query}
        if limit is not None:
            body["limit"] = limit
        if scope is not None:
            body["scope"] = scope
        return cast(
            RecallMemoriesResponse,
            await self._object(
                "POST",
                "/api/memories/recall",
                body,
                headers=self._memory_headers(user_id, memory_grant),
            ),
        )

    async def list_threads(
        self,
        *,
        user_id: str,
        agent_id: str,
        include_archived: bool = False,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> ListThreadsResponse:
        """List a user's threads for one agent and retain the pagination cursor."""
        query: Json = {"userId": user_id, "agentId": agent_id}
        if include_archived:
            query["includeArchived"] = "true"
        if limit is not None:
            query["limit"] = limit
        if cursor is not None:
            query["cursor"] = cursor
        return cast(ListThreadsResponse, await self._object("GET", "/api/threads", query=query))

    async def _thread(
        self, method: str, path: str, body: Json | None = None, query: Json | None = None
    ) -> ThreadSummary:
        """Unwrap the platform's thread envelope."""
        result = await self._object(method, path, body, query)
        thread = result.get("thread")
        if not isinstance(thread, dict) or not isinstance(thread.get("id"), str):
            raise IntelligenceError(502, "Invalid thread response")
        return cast(ThreadSummary, thread)

    async def get_thread(self, *, thread_id: str, user_id: str) -> ThreadSummary:
        """Read a thread with the caller's explicit user scope."""
        return await self._thread(
            "GET", "/api/threads/" + segment(thread_id), query={"userId": user_id}
        )

    async def create_thread(
        self,
        *,
        thread_id: str,
        user_id: str,
        agent_id: str,
        name: str | None = None,
        learning_container_id: str | None = None,
    ) -> ThreadSummary:
        """Create a thread and optionally assign its stable Learning Container ID."""
        body: Json = {"threadId": thread_id, "userId": user_id, "agentId": agent_id}
        if name is not None:
            body["name"] = name
        if learning_container_id is not None:
            body["learningContainerId"] = learning_container_id
        return await self._thread("POST", "/api/threads", body)

    async def get_or_create_thread(
        self,
        *,
        thread_id: str,
        user_id: str,
        agent_id: str,
        name: str | None = None,
        learning_container_id: str | None = None,
    ) -> ThreadResolution:
        """Resolve concurrent creation with a scoped read after a 409 conflict."""
        try:
            return {
                "thread": await self.get_thread(thread_id=thread_id, user_id=user_id),
                "created": False,
            }
        except IntelligenceError as error:
            if error.status != 404:
                raise
        try:
            thread = await self.create_thread(
                thread_id=thread_id,
                user_id=user_id,
                agent_id=agent_id,
                name=name,
                learning_container_id=learning_container_id,
            )
            return {"thread": thread, "created": True}
        except IntelligenceError as error:
            if error.status != 409:
                raise
            return {
                "thread": await self.get_thread(thread_id=thread_id, user_id=user_id),
                "created": False,
            }

    async def update_thread(
        self, *, thread_id: str, user_id: str, agent_id: str, updates: Json
    ) -> ThreadSummary:
        """Update thread metadata without letting updates replace caller identity."""
        return await self._thread(
            "PATCH",
            "/api/threads/" + segment(thread_id),
            {**updates, "userId": user_id, "agentId": agent_id},
        )

    async def archive_thread(self, *, thread_id: str, user_id: str, agent_id: str) -> None:
        """Archive a thread while retaining its messages."""
        await self.update_thread(
            thread_id=thread_id, user_id=user_id, agent_id=agent_id, updates={"archived": True}
        )

    async def delete_thread(self, *, thread_id: str, user_id: str, agent_id: str) -> None:
        """Permanently delete a thread and its history."""
        await self._request(
            "DELETE",
            "/api/threads/" + segment(thread_id),
            {
                "userId": user_id,
                "agentId": agent_id,
                "reason": f"Deleted via CopilotKit SDK (userId={user_id}, agentId={agent_id})",
            },
        )

    async def get_thread_messages(self, *, thread_id: str, user_id: str) -> ThreadMessagesResponse:
        """Read persisted messages in chronological order."""
        return cast(
            ThreadMessagesResponse,
            await self._object(
                "GET", "/api/threads/" + segment(thread_id) + "/messages", query={"userId": user_id}
            ),
        )

    async def get_thread_events(self, *, thread_id: str) -> ThreadEventsResponse:
        """Read project-authorized persisted events through the inspection API."""
        return cast(
            ThreadEventsResponse,
            await self._object("GET", "/api/_inspect/threads/" + segment(thread_id) + "/events"),
        )

    async def get_thread_state(self, *, thread_id: str) -> ThreadStateResponse:
        """Read the platform's folded state and snapshot-presence marker."""
        return cast(
            ThreadStateResponse,
            await self._object("GET", "/api/_inspect/threads/" + segment(thread_id) + "/state"),
        )

    async def annotate(
        self,
        *,
        user_id: str,
        thread_id: str,
        annotation_type: str,
        client_event_id: str | None = None,
        payload: Json | None = None,
        occurred_at: str | None = None,
    ) -> AnnotateResponse:
        """Write an annotation; reuse client_event_id for an idempotent retry."""
        body: Json = {"type": annotation_type, "userId": user_id, "threadId": thread_id}
        if payload is not None:
            body["payload"] = payload
        if occurred_at is not None:
            body["occurredAt"] = occurred_at
        return cast(
            AnnotateResponse,
            await self._object(
                "PUT",
                "/connector/annotate/"
                + segment(client_event_id if client_event_id is not None else str(uuid4())),
                body,
            ),
        )
