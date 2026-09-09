"""Intelligence-only multi-route ASGI application."""

import asyncio
import inspect
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

import httpx
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from .a2ui import A2UIConfig, A2UIMiddleware
from .agents import Agent
from .gateway import Gateway
from .mcp_apps import MCPAppsConfig, MCPAppsMiddleware, MCPServer
from .models import Json, PlatformError, RuntimeConfig, RuntimeErrorResponse, User
from .platform import Platform, segment
from .telemetry import Telemetry

IdentifyUser = Callable[[Request], Awaitable[User | None] | User | None]
MemoryPolicy = Callable[[User, Request], Awaitable[Json] | Json]
LearningSelector = Callable[[User, str, Json], Awaitable[str | None] | str | None]
ErrorHandler = Callable[[Exception, str], Awaitable[None]]


def required(body: Json, key: str) -> str:
    """Require an opaque, nonempty string without whitespace-only identifiers."""
    value = body.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeErrorResponse(400, f"Valid {key} is required")
    return value


class IntelligenceRuntime:
    """Mount on ASGI directly, or mount its app in FastAPI/Starlette.

    Agents receive independent JSON inputs. Identity and memory policy callbacks
    run on the server for every request. Analytics use a bounded background queue.
    """

    def __init__(
        self,
        config: RuntimeConfig,
        *,
        agents: Mapping[str, Agent],
        identify_user: IdentifyUser,
        memory_policy: MemoryPolicy | None = None,
        learning_container: LearningSelector | None = None,
        telemetry: Telemetry | None = None,
        http_client: httpx.AsyncClient | None = None,
        a2ui: A2UIConfig | None = None,
        mcp_apps: MCPAppsConfig | None = None,
        on_error: ErrorHandler | None = None,
    ) -> None:
        self.config = config
        self.agents = dict(agents)
        self.identify_user = identify_user
        self.memory_policy = memory_policy
        self.learning_container = learning_container
        self.on_error = on_error
        if on_error is not None and not (
            inspect.iscoroutinefunction(on_error)
            or inspect.iscoroutinefunction(getattr(on_error, "__call__", None))
        ):
            raise ValueError("Application error handler must be async")
        self.a2ui = a2ui
        self.mcp_apps = MCPAppsMiddleware(mcp_apps) if mcp_apps else None
        self.telemetry = telemetry or Telemetry(config.telemetry_enabled)
        self._owned_client = http_client is None
        self.client = http_client or httpx.AsyncClient()
        self.platform = Platform(config, self.client)
        self._runs: dict[str, tuple[asyncio.Task[None], str, str]] = {}
        self._closing = False
        self._instance_reported = False
        base = config.base_path.rstrip("/")
        self.app = Starlette(
            routes=[
                Route(
                    base + "/{path:path}",
                    self._handle,
                    methods=["GET", "POST", "PATCH", "DELETE", "PUT"],
                )
            ],
            lifespan=self._lifespan,
        )
        if config.allowed_origins:
            self.app.add_middleware(
                CORSMiddleware,
                allow_origins=list(config.allowed_origins),
                allow_credentials="*" not in config.allowed_origins,
                allow_methods=["GET", "POST", "PATCH", "DELETE", "PUT"],
                allow_headers=["Content-Type", "Authorization", "traceparent"],
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Serve the runtime as an ASGI 3 application."""
        await self.app(scope, receive, send)

    @asynccontextmanager
    async def _lifespan(self, app: Starlette) -> AsyncIterator[None]:
        """Drain owned work when the host shuts down the ASGI application."""
        yield
        await self.aclose()

    async def aclose(self) -> None:
        """Cancel runs, wait for lock cleanup, and close owned HTTP connections."""
        self._closing = True
        tasks = [item[0] for item in self._runs.values()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(tasks, timeout=self.config.shutdown_timeout)
        if self._owned_client:
            await self.client.aclose()
        await self.telemetry.aclose()

    async def _body(self, request: Request) -> Json:
        """Read a bounded JSON object without buffering an unbounded request."""
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > self.config.max_body_bytes:
                raise RuntimeErrorResponse(413, "Request body too large")
        if not raw:
            return {}
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError) as error:
            raise RuntimeErrorResponse(400, "Invalid JSON body") from error
        if not isinstance(body, dict):
            raise RuntimeErrorResponse(400, "Request body must be an object")
        return body

    async def _user(self, request: Request) -> User:
        """Resolve identity exclusively through the host authentication callback."""
        result = self.identify_user(request)
        user = await result if inspect.isawaitable(result) else result
        if not isinstance(user, User) or not user.id.strip():
            raise RuntimeErrorResponse(401, "Authentication required")
        return user

    async def _handle(self, request: Request) -> Response:
        """Apply consistent errors and payload-free telemetry to every mounted route."""
        if not self._instance_reported:
            self._instance_reported = True
            await self.telemetry.emit("oss.runtime.instance_created", agentsAmount=len(self.agents))
        path = request.path_params["path"].strip("/").split("/")
        if (
            len(path) == 3
            and path[0] == "agent"
            and path[2] in ("run", "connect")
            and request.method == "POST"
        ):
            await self.telemetry.emit("oss.runtime.copilot_request_created", requestType=path[2])
        try:
            return await self._dispatch(request, path)
        except PlatformError as error:
            await self._report_error(error, "platform")
            status = error.status if 400 <= error.status < 500 else 502
            if len(path) == 3 and path[0] == "agent" and path[2] == "connect":
                status = error.status
            return JSONResponse({"error": str(error)}, status_code=status)
        except RuntimeErrorResponse as error:
            return JSONResponse({"error": str(error)}, status_code=error.status)
        except Exception as error:
            await self._report_error(error, "request")
            logging.getLogger(__name__).error("Runtime request failed")
            return JSONResponse({"error": "Runtime request failed"}, status_code=500)

    async def _report_error(self, error: Exception, phase: str) -> None:
        """Call the application's async diagnostic handler, separate from analytics."""
        if self.on_error:
            try:
                async with asyncio.timeout(3):
                    await self.on_error(error, phase)
            except Exception:
                logging.getLogger(__name__).warning("Application error handler failed")

    async def _dispatch(self, request: Request, path: list[str]) -> Response:
        """Dispatch only known multiroute endpoints; no legacy fallback exists."""
        method = request.method
        if path == ["info"]:
            if method != "GET":
                raise RuntimeErrorResponse(405, "Method not allowed")
            return await self._info()
        user = await self._user(request)
        body = await self._body(request) if method != "GET" else {}
        if path[0] == "agent" and len(path) >= 3:
            agent_id = path[1]
            if agent_id not in self.agents:
                raise RuntimeErrorResponse(404, "Agent not found")
            if path[2] == "run" and len(path) == 3 and method == "POST":
                return await self._run(agent_id, body, user)
            if path[2] == "connect" and len(path) == 3 and method == "POST":
                thread_id = required(body, "threadId")
                data = await self.platform.request(
                    "POST",
                    f"/api/threads/{segment(thread_id)}/connect",
                    {"userId": user.id, "agentId": agent_id},
                )
                if data is None:
                    return Response(status_code=204)
                self._credentials(data)
                return JSONResponse(
                    {
                        "threadId": data["threadId"],
                        "joinToken": data["joinToken"],
                        "realtime": self._realtime(data["threadId"]),
                    },
                    headers={"Cache-Control": "no-cache"},
                )
            if path[2] == "stop" and len(path) == 4 and method == "POST":
                entry = self._runs.get(path[3])
                stopped = entry is not None and entry[1:] == (user.id, agent_id)
                if stopped and entry:
                    entry[0].cancel()
                data = {"stopped": stopped}
                if stopped:
                    data["interrupt"] = {
                        "type": "RUN_ERROR",
                        "message": "Run stopped by user",
                        "code": "STOPPED",
                    }
                return JSONResponse(data)
        if path[0] == "threads":
            return await self._threads(request, path, body, user)
        if path[0] == "memories":
            return await self._memories(request, path, body, user)
        if path == ["annotate"] and method == "POST":
            fields = {
                "userId": user.id,
                "threadId": required(body, "threadId"),
                "type": required(body, "type"),
            }
            fields.update({key: body[key] for key in ("payload", "occurredAt") if key in body})
            event_id = body.get("clientEventId") or str(uuid4())
            if not isinstance(event_id, str):
                raise RuntimeErrorResponse(400, "Invalid clientEventId")
            data = await self.platform.request(
                "PUT", "/connector/annotate/" + segment(event_id), fields
            )
            if not isinstance(data, dict):
                raise PlatformError(502, "Invalid annotation response")
            return JSONResponse(data)
        raise RuntimeErrorResponse(404, "Route not found")

    async def _info(self) -> Response:
        """Advertise only configured capabilities and live platform entitlements."""
        try:
            entitlement = await self.platform.request("GET", "/api/entitlements/runtime")
        except PlatformError:
            entitlement = {
                "status": "unavailable",
                "error": {
                    "code": "runtime_entitlements_unavailable",
                    "message": "Runtime entitlement lookup failed",
                    "retryable": True,
                },
            }
        active = entitlement.get("status") == "ready" and entitlement.get("entitlement", {}).get(
            "active"
        )
        return JSONResponse(
            {
                "version": "0.1.0",
                "mode": "intelligence",
                "agents": {
                    name: {
                        "name": name,
                        "description": agent.description,
                        "className": type(agent).__name__,
                    }
                    for name, agent in self.agents.items()
                },
                "intelligence": {"wsUrl": self.config.client_url},
                "threadEndpoints": {
                    "list": True,
                    "inspect": True,
                    "mutations": True,
                    "realtimeMetadata": True,
                },
                "runtimeEntitlements": entitlement,
                "licenseStatus": "valid" if active else "none",
                "telemetryDisabled": not self.telemetry.enabled,
                "a2uiEnabled": bool(self.a2ui and self.a2ui.enabled),
                **(
                    {
                        "a2ui": {
                            "enabled": True,
                            **(
                                {"agents": list(self.a2ui.agents)}
                                if self.a2ui.agents is not None
                                else {}
                            ),
                        }
                    }
                    if self.a2ui and self.a2ui.enabled
                    else {}
                ),
                "openGenerativeUIEnabled": False,
                "audioFileTranscriptionEnabled": False,
                "suggestions": False,
                "inspectorMetadata": False,
            }
        )

    def _realtime(self, thread_id: str) -> Json:
        """Build browser connection metadata using the distinct client endpoint."""
        return {"clientUrl": self.config.client_url, "topic": f"thread:{thread_id}"}

    def _credentials(self, data: Any, run: bool = False) -> None:
        """Reject malformed successful platform replies before serving credentials."""
        fields = ("threadId", "joinToken", "runId") if run else ("threadId", "joinToken")
        if not isinstance(data, dict) or any(
            not isinstance(data.get(key), str) or not data[key] for key in fields
        ):
            raise PlatformError(502, "Run connection credentials not available")

    async def _run(self, agent_id: str, body: Json, user: User) -> Response:
        """Acquire canonical ownership and join ingestion before returning success."""
        if self._closing:
            raise RuntimeErrorResponse(503, "Runtime is shutting down")
        thread_id, run_id = required(body, "threadId"), required(body, "runId")
        for key, kind in (("messages", list), ("tools", list), ("context", list), ("state", dict)):
            if key in body and not isinstance(body[key], kind):
                raise RuntimeErrorResponse(400, f"Invalid {key}")
        for message in body.get("messages", []):
            if not isinstance(message, dict) or not isinstance(message.get("id"), str):
                raise RuntimeErrorResponse(400, "Invalid message")
        fields = {"threadId": thread_id, "userId": user.id, "agentId": agent_id}
        if self.learning_container:
            selected = self.learning_container(user, agent_id, body)
            container = await selected if inspect.isawaitable(selected) else selected
            if container is not None:
                if not isinstance(container, str) or not container.strip():
                    raise RuntimeErrorResponse(500, "Invalid learning container")
                fields["learningContainerId"] = container
        await self.platform.get_or_create_thread(fields)
        lock = await self.platform.request(
            "POST",
            f"/api/threads/{segment(thread_id)}/lock",
            {**fields, "runId": run_id, "ttlSeconds": self.config.lock_ttl_seconds},
        )
        canonical_thread = lock.get("threadId", thread_id) if isinstance(lock, dict) else thread_id
        canonical_run = lock.get("runId", run_id) if isinstance(lock, dict) else run_id
        gateway = Gateway(
            self.config, canonical_thread or thread_id, canonical_run or run_id, self.telemetry
        )
        try:
            self._credentials(lock, run=True)
            history = await self.platform.request(
                "GET",
                f"/api/threads/{segment(canonical_thread)}/messages",
                query={"userId": user.id},
            )
            if not isinstance(history, dict) or not isinstance(history.get("messages"), list):
                raise PlatformError(502, "Invalid thread history")
            ids = {message["id"] for message in history["messages"]}
            input = {**body, "threadId": canonical_thread, "runId": canonical_run}
            new_messages = [
                message for message in body.get("messages", []) if message["id"] not in ids
            ]
            try:
                await gateway.join()
            except Exception as error:
                raise PlatformError(502, "Failed to join Intelligence gateway") from error
        except BaseException:
            await gateway.aclose()
            await self._cleanup(canonical_thread or thread_id, canonical_run or run_id)
            raise
        task = asyncio.create_task(
            self._execute(agent_id, input, new_messages, gateway), name="copilotkit-agent-run"
        )
        self._runs[canonical_thread] = (task, user.id, agent_id)
        return JSONResponse(
            {
                "threadId": canonical_thread,
                "runId": canonical_run,
                "joinToken": lock["joinToken"],
                "realtime": self._realtime(canonical_thread),
            },
            headers={"Cache-Control": "no-cache"},
        )

    async def _cleanup(self, thread_id: str, run_id: str) -> None:
        """Release only this run's platform lock after completion or failure."""
        try:
            await self.platform.request(
                "DELETE", f"/api/threads/{segment(thread_id)}/lock", {"runId": run_id}
            )
        except Exception as error:
            await self._report_error(error, "lock.cleanup")
            await self.telemetry.emit("runtime.lock.cleanup_failed", outcome="error")

    async def _renew(self, gateway: Gateway) -> None:
        """Renew ownership until shutdown; failure cancels the producer task group."""
        while True:
            await asyncio.sleep(self.config.lock_heartbeat_seconds)
            await self.platform.request(
                "PATCH",
                f"/api/threads/{segment(gateway.thread_id)}/lock",
                {"runId": gateway.run_id, "ttlSeconds": self.config.lock_ttl_seconds},
            )
            await self.telemetry.emit("runtime.lock.renewed")

    async def _execute(
        self, agent_id: str, input: Json, messages: list[Json], gateway: Gateway
    ) -> None:
        """Persist ordered agent events while heartbeat failures abort execution."""
        started = time.monotonic()
        await self.telemetry.emit("oss.runtime.agent_execution_stream_started")
        outcome = "complete"
        try:
            async with asyncio.TaskGroup() as group:
                renewal = group.create_task(self._renew(gateway))
                keepalive = group.create_task(gateway.keepalive())
                seen_start = False
                terminal = False
                async for event in self._agent_events(agent_id, input):
                    if terminal:
                        raise ValueError("Agent emitted after terminal event")
                    if not seen_start:
                        seen_start = True
                        await gateway.send(
                            {"type": "RUN_STARTED", "input": {**input, "messages": messages}}
                        )
                    if event.get("type") == "RUN_STARTED":
                        continue
                    await gateway.send(event)
                    terminal = event.get("type") in ("RUN_FINISHED", "RUN_ERROR")
                    if event.get("type") == "RUN_ERROR":
                        outcome = "error"
                        await self._report_error(
                            RuntimeError("Agent emitted RUN_ERROR"), "agent.event"
                        )
                if not seen_start:
                    await gateway.send(
                        {"type": "RUN_STARTED", "input": {**input, "messages": messages}}
                    )
                if not terminal:
                    await gateway.send({"type": "RUN_FINISHED"})
                renewal.cancel()
                keepalive.cancel()
        except asyncio.CancelledError:
            outcome = "cancelled"
            try:
                await gateway.send(
                    {"type": "RUN_ERROR", "message": "Run stopped", "code": "STOPPED"}
                )
            except Exception:
                pass
        except Exception as error:
            await self._report_error(error, "agent.execution")
            outcome = "error"
            try:
                await gateway.send({"type": "RUN_ERROR", "message": "Agent execution failed"})
            except Exception:
                pass
        finally:
            await gateway.aclose()
            await self._cleanup(gateway.thread_id, gateway.run_id)
            entry = self._runs.get(gateway.thread_id)
            if entry and entry[0] is asyncio.current_task():
                self._runs.pop(gateway.thread_id, None)
            await self.telemetry.emit(
                "oss.runtime.agent_execution_stream_ended"
                if outcome == "complete"
                else "oss.runtime.agent_execution_stream_errored",
                outcome=outcome,
                duration_ms=(time.monotonic() - started) * 1000,
                error="RUN_STOPPED" if outcome == "cancelled" else "AGENT_EXECUTION_FAILED",
            )

    async def _agent_events(self, agent_id: str, input: Json) -> AsyncIterator[Json]:
        """Transform configured UI features before canonical Intelligence ingestion."""
        proxy = input.get("forwardedProps", {}).get("__proxiedMCPRequest")
        if proxy is not None:
            if not self.mcp_apps or not isinstance(proxy, dict):
                raise ValueError("MCP Apps proxy is not configured")
            async for event in self.mcp_apps.proxy(proxy, agent_id):
                yield event
            return
        a2ui = A2UIMiddleware(self.a2ui) if self.a2ui and self.a2ui.applies(agent_id) else None
        prepared = a2ui.prepare(input) if a2ui else input
        ui_tools: dict[str, tuple[MCPServer, str]] = {}
        if self.mcp_apps:
            prepared, ui_tools = await self.mcp_apps.discover(prepared, agent_id)
        source = self.agents[agent_id].run(prepared)
        if self.mcp_apps:
            source = self.mcp_apps.transform(source, prepared, ui_tools)
        if a2ui:
            source = a2ui.transform(source, input)
        async for event in source:
            yield event

    async def _threads(self, request: Request, path: list[str], body: Json, user: User) -> Response:
        """Forward thread operations with trusted identity and explicit ownership checks."""
        method = request.method
        if len(path) == 1 and method == "GET":
            query = {
                key: value
                for key, value in request.query_params.items()
                if key in ("agentId", "includeArchived", "limit", "cursor")
            }
            required(query, "agentId")
            query["userId"] = user.id
            return JSONResponse(await self.platform.request("GET", "/api/threads", query=query))
        if path == ["threads", "subscribe"] and method == "POST":
            data = await self.platform.request(
                "POST", "/api/threads/subscribe", {"userId": user.id}
            )
            return JSONResponse(data)
        if len(path) < 2:
            raise RuntimeErrorResponse(405, "Method not allowed")
        endpoint = "/api/threads/" + segment(path[1])
        if len(path) == 3 and method == "GET" and path[2] in ("messages", "events", "state"):
            if path[2] == "messages":
                data = await self.platform.request(
                    "GET", endpoint + "/messages", query={"userId": user.id}
                )
            else:
                await self.platform.request("GET", endpoint, query={"userId": user.id})
                data = await self.platform.request(
                    "GET", "/api/_inspect/threads/" + segment(path[1]) + "/" + path[2]
                )
                if path[2] == "state":
                    data = {"state": data.get("state") if data.get("kind") == "snapshot" else None}
                else:
                    data = {"events": data["events"]}
            return JSONResponse(data)
        if len(path) == 2 and method == "GET":
            return JSONResponse(
                await self.platform.request("GET", endpoint, query={"userId": user.id})
            )
        archive = len(path) == 3 and path[2] == "archive" and method == "POST"
        if archive or (len(path) == 2 and method in ("PATCH", "DELETE")):
            fields: Json = {"agentId": required(body, "agentId"), "userId": user.id}
            fields.update({key: body[key] for key in ("name", "archived") if key in body})
            if "name" in fields and not isinstance(fields["name"], str):
                raise RuntimeErrorResponse(400, "Invalid name")
            if "archived" in fields and not isinstance(fields["archived"], bool):
                raise RuntimeErrorResponse(400, "Invalid archived")
            if archive:
                fields["archived"] = True
            data = await self.platform.request("PATCH" if archive else method, endpoint, fields)
            if archive:
                return JSONResponse({"threadId": path[1], "archived": True})
            if method == "DELETE":
                return JSONResponse({"threadId": path[1], "deleted": True})
            if not isinstance(data, dict) or not isinstance(data.get("thread"), dict):
                raise PlatformError(502, "Invalid thread response")
            return JSONResponse(data["thread"])
        raise RuntimeErrorResponse(405, "Method not allowed")

    async def _memories(
        self, request: Request, path: list[str], body: Json, user: User
    ) -> Response:
        """Apply trusted memory grants and validate writes before forwarding."""
        headers = {"x-cpki-user-id": user.id}
        if self.memory_policy:
            selected = self.memory_policy(user, request)
            grant = await selected if inspect.isawaitable(selected) else selected
            if any(
                grant.get(key) not in ("none", "read", "read-write") for key in ("user", "project")
            ):
                raise RuntimeErrorResponse(500, "Invalid memory grant")
            headers["x-cpki-memory-grant"] = json.dumps(
                {key: grant[key] for key in ("user", "project")}
            )
        method = request.method
        endpoint = "/api/memories" + ("/" + segment(path[1]) if len(path) == 2 else "")
        if len(path) > 2:
            raise RuntimeErrorResponse(404, "Route not found")
        if len(path) == 1 and method == "GET":
            query = (
                {"includeInvalidated": "true"}
                if request.query_params.get("includeInvalidated") == "true"
                else None
            )
            data = await self.platform.request("GET", endpoint, query=query, headers=headers)
        elif path == ["memories", "subscribe"] and method == "POST":
            data = await self.platform.request("POST", endpoint, headers=headers)
        elif path == ["memories", "recall"] and method == "POST":
            fields: Json = {"query": required(body, "query").strip()}
            if "limit" in body:
                if type(body["limit"]) is not int or body["limit"] <= 0:
                    raise RuntimeErrorResponse(400, "Invalid limit")
                fields["limit"] = body["limit"]
            self._memory_scope(body, fields)
            data = await self.platform.request("POST", endpoint, fields, headers=headers)
        elif (len(path) == 1 and method == "POST") or (len(path) == 2 and method == "PATCH"):
            if not isinstance(body.get("content"), str) or body.get("kind") not in (
                "topical",
                "episodic",
                "operational",
            ):
                raise RuntimeErrorResponse(400, "Invalid memory content or kind")
            sources = body.get("sourceThreadIds", [])
            if not isinstance(sources, list) or any(not isinstance(item, str) for item in sources):
                raise RuntimeErrorResponse(400, "Invalid sourceThreadIds")
            fields = {"content": body["content"], "kind": body["kind"], "sourceThreadIds": sources}
            self._memory_scope(body, fields)
            data = await self.platform.request(method, endpoint, fields, headers=headers)
        elif len(path) == 2 and method == "DELETE":
            await self.platform.request("DELETE", endpoint, headers=headers)
            return Response(status_code=204)
        else:
            raise RuntimeErrorResponse(405, "Method not allowed")
        if (len(path) == 1 and method == "GET") or path == ["memories", "recall"]:
            if not isinstance(data, dict) or not isinstance(data.get("memories"), list):
                raise PlatformError(502, "Invalid memory response")
        return JSONResponse(data, status_code=201 if len(path) == 1 and method == "POST" else 200)

    def _memory_scope(self, body: Json, fields: Json) -> None:
        """Accept only platform-defined memory scopes."""
        if "scope" in body:
            if body["scope"] not in ("user", "project"):
                raise RuntimeErrorResponse(400, "Invalid memory scope")
            fields["scope"] = body["scope"]
