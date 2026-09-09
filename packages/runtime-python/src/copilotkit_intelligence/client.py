"""Runtime-independent, asynchronous Intelligence API client."""

import json
import math
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Literal, Self
from urllib.parse import quote, urlsplit
from uuid import uuid4

import httpx

Json = dict[str, Any]
Access = Literal["none", "read", "read-write"]


class IntelligenceError(Exception):
    """A safe platform failure with its HTTP status and no response-body disclosure."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


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

    The client has no ASGI dependency, background task, or agent requirement.
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

    async def __aenter__(self) -> Self:
        """Use this client within an asynchronous context."""
        return self

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
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as error:
            raise IntelligenceError(502, "Invalid Intelligence response") from error

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

    async def list_memories(
        self,
        *,
        user_id: str,
        memory_grant: MemoryGrant | None = None,
        include_invalidated: bool = False,
    ) -> Json:
        """List memories; include retired entries only when requested."""
        return await self._object(
            "GET",
            "/api/memories",
            query={"includeInvalidated": "true"} if include_invalidated else None,
            headers=self._memory_headers(user_id, memory_grant),
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
    ) -> Json:
        """Save a memory, retaining the platform's absorbed marker."""
        body: Json = {"content": content, "kind": kind, "sourceThreadIds": source_thread_ids or []}
        if scope is not None:
            body["scope"] = scope
        return await self._object(
            "POST", "/api/memories", body, headers=self._memory_headers(user_id, memory_grant)
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
    ) -> Json:
        """Supersede a memory and return its replacement and retired ID."""
        body: Json = {"content": content, "kind": kind, "sourceThreadIds": source_thread_ids or []}
        if scope is not None:
            body["scope"] = scope
        return await self._object(
            "PATCH",
            "/api/memories/" + segment(memory_id),
            body,
            headers=self._memory_headers(user_id, memory_grant),
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
    ) -> Json:
        """Recall relevant memories with the platform's relevance scores."""
        body: Json = {"query": query}
        if limit is not None:
            body["limit"] = limit
        if scope is not None:
            body["scope"] = scope
        return await self._object(
            "POST",
            "/api/memories/recall",
            body,
            headers=self._memory_headers(user_id, memory_grant),
        )

    async def list_threads(
        self,
        *,
        user_id: str,
        agent_id: str,
        include_archived: bool = False,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> Json:
        """List a user's threads for one agent and retain the pagination cursor."""
        query: Json = {"userId": user_id, "agentId": agent_id}
        if include_archived:
            query["includeArchived"] = "true"
        if limit is not None:
            query["limit"] = limit
        if cursor is not None:
            query["cursor"] = cursor
        return await self._object("GET", "/api/threads", query=query)

    async def _thread(
        self, method: str, path: str, body: Json | None = None, query: Json | None = None
    ) -> Json:
        """Unwrap the platform's thread envelope."""
        result = await self._object(method, path, body, query)
        thread = result.get("thread")
        if not isinstance(thread, dict) or not isinstance(thread.get("id"), str):
            raise IntelligenceError(502, "Invalid thread response")
        return thread

    async def get_thread(self, *, thread_id: str, user_id: str) -> Json:
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
    ) -> Json:
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
    ) -> Json:
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
    ) -> Json:
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

    async def get_thread_messages(self, *, thread_id: str, user_id: str) -> Json:
        """Read persisted messages in chronological order."""
        return await self._object(
            "GET", "/api/threads/" + segment(thread_id) + "/messages", query={"userId": user_id}
        )

    async def get_thread_events(self, *, thread_id: str) -> Json:
        """Read project-authorized persisted events through the inspection API."""
        return await self._object("GET", "/api/_inspect/threads/" + segment(thread_id) + "/events")

    async def get_thread_state(self, *, thread_id: str) -> Json:
        """Read the platform's folded state and snapshot-presence marker."""
        return await self._object("GET", "/api/_inspect/threads/" + segment(thread_id) + "/state")

    async def annotate(
        self,
        *,
        user_id: str,
        thread_id: str,
        annotation_type: str,
        client_event_id: str | None = None,
        payload: Json | None = None,
        occurred_at: str | None = None,
    ) -> Json:
        """Write an annotation; reuse client_event_id for an idempotent retry."""
        body: Json = {"type": annotation_type, "userId": user_id, "threadId": thread_id}
        if payload is not None:
            body["payload"] = payload
        if occurred_at is not None:
            body["occurredAt"] = occurred_at
        return await self._object(
            "PUT",
            "/connector/annotate/"
            + segment(client_event_id if client_event_id is not None else str(uuid4())),
            body,
        )
