"""Exercise integration forwarding shims through real OpenAI HTTP clients."""

import asyncio
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import httpx
import httpx2
import openai
import pytest

INTEGRATIONS = Path(__file__).resolve().parents[3] / "integrations"
# These integrations use OpenAI directly or through their framework provider.
# AG2 is the already-working httpx2 control; Gemini/Claude-only backends do not
# use this OpenAI path. Load the production shim rather than a test substitute.
OPENAI_INTEGRATIONS = (
    "ag2",
    "agno",
    "crewai-conversational-flows",
    "crewai-crews",
    "langroid",
    "llamaindex",
    "ms-agent-python",
    "pydantic-ai",
    "strands",
)


@pytest.fixture(params=OPENAI_INTEGRATIONS)
def forwarding(request, monkeypatch):
    monkeypatch.syspath_prepend(str(INTEGRATIONS))
    # The production installer patches constructors globally. Restore both
    # transports between integrations so a working sibling cannot mask a gap.
    for transport in (httpx, httpx2):
        for client in (transport.Client, transport.AsyncClient):
            monkeypatch.setattr(client, "__init__", client.__init__)
    spec = importlib.util.spec_from_file_location(
        f"forwarding_{request.param.replace('-', '_')}",
        INTEGRATIONS / request.param / "src/agents/_header_forwarding.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.install_global_httpx_hook()
    module.install_global_httpx_hook()
    return request.param, module


@pytest.fixture
def provider():
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "id": "header-echo",
                        "object": "chat.completion",
                        "created": 0,
                        "model": "test",
                        "choices": [
                            {
                                "index": 0,
                                "finish_reason": "stop",
                                "message": {
                                    "role": "assistant",
                                    "content": json.dumps(dict(self.headers)),
                                },
                            }
                        ],
                    }
                ).encode()
            )

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def context_from(response):
    headers = json.loads(response.choices[0].message.content)
    return {key.lower(): value for key, value in headers.items()}.get(
        "x-aimock-context"
    )


def test_openai_sync_forwards_aimock_context(forwarding, provider):
    slug, module = forwarding
    module.set_forwarded_headers({"x-aimock-context": slug})
    with openai.OpenAI(api_key="test", base_url=provider) as client:
        response = client.chat.completions.create(
            model="test", messages=[{"role": "user", "content": "hello"}]
        )
        assert context_from(response) == slug
        assert len(client._client.event_hooks["request"]) == 1


@pytest.mark.parametrize("forwarding", ("agno", "langroid"), indirect=True)
@pytest.mark.parametrize("transport", (httpx, httpx2), ids=("httpx", "httpx2"))
def test_sync_subclass_named_asyncclient_forwards_aimock_context(
    forwarding, provider, transport
):
    # A valid sync transport can have a misleading subclass name. The actual
    # transport type must determine which kind of request hook it consumes.
    class AsyncClient(transport.Client):
        pass

    slug, module = forwarding
    module.set_forwarded_headers({"x-aimock-context": slug})
    with AsyncClient() as client:
        response = client.post(provider + "/chat/completions", json={})
        assert context_from(openai.types.chat.ChatCompletion(**response.json())) == slug
        assert len(client.event_hooks["request"]) == 1


def test_openai_async_keeps_concurrent_contexts_isolated(forwarding, provider):
    slug, module = forwarding

    async def run():
        async with openai.AsyncOpenAI(api_key="test", base_url=provider) as client:

            async def send(context):
                module.set_forwarded_headers({"x-aimock-context": context})
                await asyncio.sleep(0)
                response = await client.chat.completions.create(
                    model="test", messages=[{"role": "user", "content": "hello"}]
                )
                return context_from(response)

            assert await asyncio.gather(send(slug), send(slug + "/other")) == [
                slug,
                slug + "/other",
            ]
            assert len(client._client.event_hooks["request"]) == 1

    asyncio.run(run())


def test_legacy_httpx_still_forwards_aimock_context(forwarding, provider):
    slug, module = forwarding
    module.set_forwarded_headers({"x-aimock-context": slug})
    with httpx.Client() as client:
        response = client.post(provider + "/chat/completions", json={})
        assert context_from(openai.types.chat.ChatCompletion(**response.json())) == slug
        assert len(client.event_hooks["request"]) == 1


def test_legacy_httpx_async_still_forwards_aimock_context(forwarding, provider):
    slug, module = forwarding

    async def run():
        module.set_forwarded_headers({"x-aimock-context": slug})
        async with httpx.AsyncClient() as client:
            response = await client.post(provider + "/chat/completions", json={})
            assert (
                context_from(openai.types.chat.ChatCompletion(**response.json()))
                == slug
            )
            assert len(client.event_hooks["request"]) == 1

    asyncio.run(run())


def test_older_providers_do_not_require_httpx2(monkeypatch):
    monkeypatch.syspath_prepend(str(INTEGRATIONS))
    from _shared import httpx_transports

    original_import = httpx_transports.importlib.import_module

    def without_httpx2(name):
        if name == "httpx2":
            raise ModuleNotFoundError(name=name)
        return original_import(name)

    monkeypatch.setattr(httpx_transports.importlib, "import_module", without_httpx2)
    assert list(httpx_transports.available_httpx_transports()) == [httpx]


def test_broken_installed_transport_is_not_silently_skipped(monkeypatch):
    monkeypatch.syspath_prepend(str(INTEGRATIONS))
    from _shared import httpx_transports

    original_import = httpx_transports.importlib.import_module

    def broken_httpx2(name):
        if name == "httpx2":
            raise ModuleNotFoundError(name="missing_transport_dependency")
        return original_import(name)

    monkeypatch.setattr(httpx_transports.importlib, "import_module", broken_httpx2)
    with pytest.raises(ModuleNotFoundError) as error:
        list(httpx_transports.available_httpx_transports())
    assert error.value.name == "missing_transport_dependency"
