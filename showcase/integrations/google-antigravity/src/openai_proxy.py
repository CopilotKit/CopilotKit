"""OpenAI-compatible shim between the Antigravity harness and the model endpoint.

The Go harness makes the model call itself, so nothing in this Python process
can attach per-request headers to it. This shim sits in front of the harness
and adds what the showcase needs on every call: the Authorization header the
SDK's OpenAI path cannot send, and the static ``X-AIMock-Context`` header that
selects this integration's aimock fixtures. Per-request ``X-AIMock-Strict`` /
``x-test-id`` cannot cross the harness hop; see PARITY_NOTES.md.

`google-antigravity` 0.1.8's OpenAI-compatible path (`GemmaEndpoint`) carries
only a `base_url`: there is no API-key field, and the Go harness reads no
`OPENAI_API_KEY`. The path is designed for unauthenticated local servers
(Ollama, LM Studio). This shim makes a hosted endpoint usable by:

1. adding `Authorization: Bearer $OPENAI_API_KEY`, and
2. rewriting Gemini-flavoured tool schemas into what OpenAI accepts.

(2) is needed because the SDK builds custom-tool schemas with
`FunctionDeclaration.from_callable_with_api_option(api_option="GEMINI_API")`,
which emits proto-style uppercase type names (`"STRING"`). Both are upstream
SDK gaps, not AG-UI ones -- drop this file once the SDK supports authenticated
OpenAI endpoints natively.

Not required for the native Gemini path.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import socket
import threading
import time
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

logger = logging.getLogger(__name__)

DEFAULT_UPSTREAM = "https://api.openai.com"

_JSON_TYPES = {"OBJECT", "STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "NULL"}


def _lower_type(value: Any) -> Any:
    """Lowercases a JSON Schema `type`, which may be a name or a list of names."""
    if isinstance(value, str) and value.upper() in _JSON_TYPES:
        return value.lower()
    if isinstance(value, list):
        return [_lower_type(v) for v in value]
    return value


def _normalize_schema(node: Any) -> Any:
    """Lowercases proto-style JSON Schema type names, at any depth."""
    if isinstance(node, list):
        return [_normalize_schema(n) for n in node]
    if not isinstance(node, dict):
        return node
    out = {}
    for key, value in node.items():
        out[key] = _lower_type(value) if key == "type" else _normalize_schema(value)
    return out


def _repair_body(body: bytes) -> bytes:
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body
    touched = False
    for tool in payload.get("tools") or []:
        fn = tool.get("function") if isinstance(tool, dict) else None
        if isinstance(fn, dict) and "parameters" in fn:
            fn["parameters"] = _normalize_schema(fn["parameters"])
            touched = True

    # response_schema= on an agent reaches OpenAI here, and carries the same
    # proto-style type names as the tool schemas.
    response_format = payload.get("response_format")
    if isinstance(response_format, dict):
        json_schema = response_format.get("json_schema")
        if isinstance(json_schema, dict) and "schema" in json_schema:
            json_schema["schema"] = _normalize_schema(json_schema["schema"])
            touched = True

    return json.dumps(payload).encode() if touched else body


def build_app(
    api_key: str,
    upstream: str = DEFAULT_UPSTREAM,
    extra_headers: dict[str, str] | None = None,
) -> FastAPI:
    app = FastAPI(title="Antigravity -> OpenAI shim")
    client = httpx.AsyncClient(base_url=upstream, timeout=httpx.Timeout(600.0))

    @app.get("/__shim_health")
    async def health():
        """Liveness of the shim itself -- deliberately does not touch upstream."""
        return {"ok": True, "upstream": upstream}

    @app.api_route("/{path:path}", methods=["GET", "POST", "DELETE", "PATCH"])
    async def proxy(path: str, request: Request):
        body = _repair_body(await request.body())
        headers = {
            "authorization": f"Bearer {api_key}",
            "content-type": request.headers.get("content-type", "application/json"),
            "accept": request.headers.get("accept", "application/json"),
        }
        headers.update(extra_headers or {})
        upstream_request = client.build_request(
            request.method,
            f"/{path}",
            content=body,
            headers=headers,
            params=dict(request.query_params),
        )
        try:
            response = await client.send(upstream_request, stream=True)
        except httpx.HTTPError as exc:
            # Starlette would turn this into `500 Internal Server Error` as
            # text/plain, which the harness cannot parse as a completion and
            # reports as a schema failure rather than an outage.
            logger.warning("Upstream %s unreachable: %s", upstream, exc)
            return Response(
                status_code=502,
                media_type="application/json",
                content=json.dumps(
                    {
                        "error": {
                            "message": f"upstream {upstream} unreachable: {exc}",
                            "type": "upstream_error",
                        }
                    }
                ),
            )
        media_type = response.headers.get("content-type", "application/json")

        if "text/event-stream" in media_type:

            async def body_iter():
                # aiter_bytes() decodes any content-encoding httpx negotiated.
                # aiter_raw() would forward gzip bytes while the header saying
                # so is dropped below, producing an unparseable stream.
                try:
                    async for chunk in response.aiter_bytes():
                        yield chunk
                except httpx.HTTPError as exc:
                    # The 200 is already on the wire, so the only way to report
                    # this is in-band -- otherwise the harness sees a stream
                    # that merely stopped and calls the turn complete.
                    logger.warning("Upstream stream failed: %s", exc)
                    error = json.dumps(
                        {"error": {"message": str(exc), "type": "upstream_error"}}
                    )
                    yield f"data: {error}\n\ndata: [DONE]\n\n".encode()
                finally:
                    with contextlib.suppress(Exception):
                        await response.aclose()

            return StreamingResponse(
                body_iter(), status_code=response.status_code, media_type=media_type
            )

        try:
            raw = await response.aread()
        except httpx.HTTPError as exc:
            logger.warning("Upstream body read failed: %s", exc)
            return Response(
                status_code=502,
                media_type="application/json",
                content=json.dumps(
                    {
                        "error": {
                            "message": f"upstream {upstream} failed mid-body: {exc}",
                            "type": "upstream_error",
                        }
                    }
                ),
            )
        finally:
            # Suppressed: a failure closing the upstream must not replace the
            # shaped error above with a bare text/plain 500.
            with contextlib.suppress(Exception):
                await response.aclose()
        return Response(
            content=raw, status_code=response.status_code, media_type=media_type
        )

    return app


def start_background(
    port: int = 8931,
    upstream: str = DEFAULT_UPSTREAM,
    extra_headers: dict[str, str] | None = None,
) -> str:
    """Starts the shim on a daemon thread and returns the base_url for the SDK.

    The returned URL has no ``/v1`` suffix: the harness appends
    ``/v1/chat/completions`` itself.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY must be set to use the OpenAI shim.")

    # Bind before starting the thread so an occupied port fails here, loudly,
    # instead of inside the daemon thread where the traceback is swallowed --
    # and so we never hand back a URL pointing at somebody else's server.
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(("127.0.0.1", port))
    except OSError as exc:
        raise RuntimeError(
            f"Port {port} is already in use, so the OpenAI shim cannot start. "
            "Set ANTIGRAVITY_SHIM_PORT to a free port."
        ) from exc
    finally:
        probe.close()

    config = uvicorn.Config(
        build_app(api_key, upstream, extra_headers=extra_headers),
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Probe the shim's own health route: hitting a proxied path instead would
    # report the *upstream* as down (slow network, bad key) as a startup
    # failure of the shim.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not thread.is_alive():
            raise RuntimeError("The OpenAI shim thread exited during startup.")
        try:
            if httpx.get(
                f"http://127.0.0.1:{port}/__shim_health", timeout=2.0
            ).is_success:
                return f"http://127.0.0.1:{port}"
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError("The OpenAI shim did not come up in time.")
