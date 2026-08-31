"""Red-green proof for FIX 3: the A2UI secondary OpenAI call must carry the
request-scoped ``x-aimock-context`` header.

The declarative-gen-ui ``generate_a2ui`` tool makes a SECONDARY OpenAI call
from inside a sync tool. agno runs under uvloop in prod, where the
executor-contextvar shim is inert, so relying on the global httpx hook +
ContextVar alone can drop the forwarded header on the secondary call → aimock
returns 503 on an empty ``x-aimock-context``.

The fix reads the captured headers via ``get_forwarded_headers()`` on the
request context that invoked the tool and passes them explicitly as
``default_headers`` to the secondary ``openai.OpenAI(...)`` client, so the
call carries the context REGARDLESS of loop type. This test asserts the
client was constructed with ``x-aimock-context`` present.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from agents import _header_forwarding as hf  # noqa: E402
from agents import a2ui_dynamic_agent as a2ui  # noqa: E402


class _FakeMessage:
    tool_calls = None


class _FakeChoice:
    message = _FakeMessage()


class _FakeResponse:
    choices = [_FakeChoice()]


class _FakeCompletions:
    def create(self, *args, **kwargs):
        return _FakeResponse()


class _FakeChat:
    completions = _FakeCompletions()


class _FakeOpenAI:
    """Records the constructor kwargs (notably ``default_headers``)."""

    last_default_headers = None

    def __init__(self, *args, **kwargs):
        type(self).last_default_headers = kwargs.get("default_headers")
        self.chat = _FakeChat()


class _RunContext:
    session_state = {}


def test_secondary_openai_call_carries_aimock_context(monkeypatch):
    """The secondary client must be built WITH the forwarded x-aimock-context."""
    # Simulate the request-scoped header capture the HTTP middleware performs.
    hf.set_forwarded_headers(
        {"x-aimock-context": "agno/declarative-gen-ui", "x-diag-run-id": "r-123"}
    )

    monkeypatch.setattr(a2ui.openai, "OpenAI", _FakeOpenAI)

    _FakeOpenAI.last_default_headers = None
    a2ui.generate_a2ui(_RunContext(), "draw a dashboard")

    headers = _FakeOpenAI.last_default_headers
    assert headers is not None, (
        "secondary OpenAI client must be constructed with default_headers"
    )
    assert headers.get("x-aimock-context") == "agno/declarative-gen-ui", (
        f"secondary call must carry the forwarded x-aimock-context, got {headers!r}"
    )


def test_secondary_openai_call_carries_aimock_context_via_executor_thread(
    monkeypatch,
):
    """The REAL prod path: ``generate_a2ui`` is a SYNC tool agno dispatches
    onto a worker thread via ``loop.run_in_executor(...)``, NOT a direct
    main-thread call.

    ``get_forwarded_headers()`` reads a ContextVar. Under uvloop the
    ``install_executor_contextvar_propagation`` shim is inert (uvloop's loop
    is not a ``BaseEventLoop`` subclass), so the ContextVar set on the inbound
    request task is EMPTY in the executor worker thread → ``default_headers``
    is ``None`` → the secondary call drops ``x-aimock-context`` → aimock 503.

    The fix pins the event loop to stdlib ``asyncio`` (``loop="asyncio"`` /
    ``--loop asyncio``), under which the shim's ``BaseEventLoop`` patch IS
    effective. This test reproduces the executor hop under a stdlib asyncio
    loop with the shim installed and asserts the secondary OpenAI client is
    constructed WITH the forwarded ``x-aimock-context``. The earlier
    direct-call test passes even WITHOUT the fix (it runs on the main thread
    where the ContextVar is set), so it does not prove the prod path; this
    one does.
    """
    monkeypatch.setattr(a2ui.openai, "OpenAI", _FakeOpenAI)

    # Guard: assert we are NOT under uvloop, so the shim can actually engage.
    # (asyncio.run uses the stdlib loop; the prod loop-pin produces the same.)
    import asyncio.base_events as _base_events

    async def _drive() -> None:
        # Sanity-check the running loop is a stdlib BaseEventLoop subclass —
        # the precondition the loop-pin guarantees and uvloop violates.
        loop = asyncio.get_running_loop()
        assert isinstance(loop, _base_events.BaseEventLoop), (
            "executor-ctxvar propagation requires a stdlib asyncio loop; "
            f"got {type(loop).__module__}.{type(loop).__name__}"
        )

        # Set the forwarded-header ContextVar on the MAIN request task, exactly
        # as HeaderForwardingHTTPMiddleware does at request scope.
        hf.set_forwarded_headers(
            {"x-aimock-context": "agno/declarative-gen-ui", "x-diag-run-id": "r-9"}
        )

        # Dispatch the SYNC tool onto a worker thread, mirroring how agno
        # invokes it. With the shim active, the ContextVar propagates into the
        # worker thread, so generate_a2ui's get_forwarded_headers() read there
        # returns the real headers.
        await loop.run_in_executor(
            None, a2ui.generate_a2ui, _RunContext(), "draw a dashboard"
        )

    # Activate the executor-ctxvar shim (the import-time call in
    # agent_server.py; idempotent here).
    hf.install_executor_contextvar_propagation()

    _FakeOpenAI.last_default_headers = None
    asyncio.run(_drive())

    headers = _FakeOpenAI.last_default_headers
    assert headers is not None, (
        "secondary OpenAI client (built in the executor worker thread) must "
        "be constructed with default_headers — None means the ContextVar did "
        "not propagate into the executor thread (the uvloop failure mode)"
    )
    assert headers.get("x-aimock-context") == "agno/declarative-gen-ui", (
        "the executor-thread secondary call must carry the forwarded "
        f"x-aimock-context, got {headers!r}"
    )
