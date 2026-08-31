"""Tests for header propagation (x-* prefixed headers to outgoing LLM calls)."""

import asyncio
import contextvars
import inspect
import warnings

import httpx
import pytest

from copilotkit.header_propagation import (
    get_forwarded_headers,
    install_httpx_hook,
    set_forwarded_headers,
)


class TestSetForwardedHeaders:
    """set_forwarded_headers filters to x-* prefixed headers only."""

    def test_filters_to_x_prefixed_headers(self):
        set_forwarded_headers(
            {
                "x-aimock-strict": "true",
                "x-aimock-session": "abc123",
                "x-request-id": "req-456",
                "x-custom-trace": "xyz",
                "authorization": "Bearer token",
                "content-type": "application/json",
            }
        )
        result = get_forwarded_headers()
        assert result == {
            "x-aimock-strict": "true",
            "x-aimock-session": "abc123",
            "x-request-id": "req-456",
            "x-custom-trace": "xyz",
        }

    def test_case_insensitive_prefix_match(self):
        set_forwarded_headers(
            {
                "X-AIMock-Strict": "true",
                "X-AIMOCK-SESSION": "xyz",
            }
        )
        result = get_forwarded_headers()
        assert result == {
            "x-aimock-strict": "true",
            "x-aimock-session": "xyz",
        }

    def test_empty_when_no_x_headers(self):
        set_forwarded_headers(
            {
                "authorization": "Bearer token",
                "content-type": "application/json",
            }
        )
        result = get_forwarded_headers()
        assert result == {}

    def test_empty_input(self):
        set_forwarded_headers({})
        result = get_forwarded_headers()
        assert result == {}


class TestGetForwardedHeaders:
    """get_forwarded_headers returns empty dict by default."""

    def test_default_is_empty_dict(self):
        # Reset to default by running in a fresh context
        ctx = contextvars.copy_context()
        result = ctx.run(get_forwarded_headers)
        assert result == {}


class TestRoundTrip:
    """set + get round-trip."""

    def test_round_trip(self):
        headers = {"x-aimock-strict": "true", "x-aimock-foo": "bar"}
        set_forwarded_headers(headers)
        assert get_forwarded_headers() == headers

    def test_overwrite(self):
        set_forwarded_headers({"x-aimock-a": "1"})
        set_forwarded_headers({"x-aimock-b": "2"})
        assert get_forwarded_headers() == {"x-aimock-b": "2"}


class TestInstallHttpxHook:
    """install_httpx_hook appends to event hooks."""

    def test_appends_to_raw_httpx_client(self):
        """Mock a raw httpx client with event_hooks dict."""

        class FakeClient:
            def __init__(self):
                self.event_hooks = {"request": []}

        client = FakeClient()
        install_httpx_hook(client)
        assert len(client.event_hooks["request"]) == 1

    def test_appends_to_sdk_wrapped_client(self):
        """Mock an OpenAI/Anthropic SDK client with _client attribute."""

        class FakeTransport:
            def __init__(self):
                self.event_hooks = {"request": []}

        class FakeSDKClient:
            def __init__(self):
                self._client = FakeTransport()

        client = FakeSDKClient()
        install_httpx_hook(client)
        assert len(client._client.event_hooks["request"]) == 1

    def test_hook_injects_headers(self):
        """The installed hook reads from ContextVar and injects headers."""

        class FakeHeaders(dict):
            """Dict that also supports item assignment like httpx Headers."""

            pass

        class FakeRequest:
            def __init__(self):
                self.headers = FakeHeaders()

        class FakeClient:
            def __init__(self):
                self.event_hooks = {"request": []}

        client = FakeClient()
        install_httpx_hook(client)

        # Set headers in ContextVar
        set_forwarded_headers({"x-aimock-strict": "true"})

        # Simulate httpx calling the hook
        request = FakeRequest()
        client.event_hooks["request"][0](request)

        assert request.headers["x-aimock-strict"] == "true"

    def test_hook_noop_when_no_headers(self):
        """Hook is a no-op when ContextVar is empty (demo traffic)."""

        class FakeRequest:
            def __init__(self):
                self.headers = {}

        class FakeClient:
            def __init__(self):
                self.event_hooks = {"request": []}

        # Reset ContextVar to simulate a fresh request with no aimock headers
        set_forwarded_headers({})

        client = FakeClient()
        install_httpx_hook(client)
        request = FakeRequest()
        client.event_hooks["request"][0](request)
        assert request.headers == {}

    def test_no_event_hooks_warns(self):
        """Client without event_hooks emits a warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            install_httpx_hook(object())
            assert len(w) == 1
            assert "event_hooks" in str(w[0].message)


class TestInstallHttpxHookNestedChain:
    """install_httpx_hook walks the ``._client`` chain (modern OpenAI SDK shape)."""

    def test_walks_chain_to_find_event_hooks(self):
        """Modern OpenAI SDK: ChatOpenAI.client -> Resource -> openai.OpenAI
        -> ._client = httpx wrapper (event_hooks here). The hook installer
        must walk past intermediate ``._client`` hops that do NOT expose
        event_hooks, and attach to the first one that does.
        """

        class HttpxWrapper:
            def __init__(self):
                self.event_hooks = {"request": []}

        class OpenAIClient:
            """Mirrors openai.OpenAI / openai.AsyncOpenAI: holds an httpx
            wrapper at ``._client`` but exposes no event_hooks itself."""

            def __init__(self):
                self._client = HttpxWrapper()

        class Resource:
            """Mirrors openai resources (Completions, AsyncCompletions, etc):
            holds the OpenAI client at ``._client``."""

            def __init__(self):
                self._client = OpenAIClient()

        class LangChainWrapper:
            """Mirrors langchain_openai.ChatOpenAI.client: the resource."""

            def __init__(self):
                self.client = Resource()

        outer = LangChainWrapper()
        install_httpx_hook(outer.client)

        # The hook MUST land on the deepest object that has event_hooks
        hooks = outer.client._client._client.event_hooks["request"]
        assert len(hooks) == 1, (
            f"expected hook installed on deepest httpx wrapper, got "
            f"{len(hooks)} hook(s) (chain walk likely stopped too shallow)"
        )

    def test_idempotent_double_install(self):
        """Calling install_httpx_hook twice must NOT register the hook twice."""

        class FakeClient:
            def __init__(self):
                self.event_hooks = {"request": []}

        client = FakeClient()
        install_httpx_hook(client)
        install_httpx_hook(client)
        assert len(client.event_hooks["request"]) == 1, (
            "install_httpx_hook must be idempotent — double install detected"
        )

    def test_header_agnostic_injection(self):
        """Hook must forward whatever headers are in the ContextVar, not just x-aimock-*."""

        class FakeRequest:
            def __init__(self):
                self.headers = {}

        class FakeClient:
            def __init__(self):
                self.event_hooks = {"request": []}

        client = FakeClient()
        install_httpx_hook(client)

        set_forwarded_headers(
            {
                "x-trace-id": "abc",
                "x-team-id": "ck",
                "x-anything-custom": "v",
            }
        )

        request = FakeRequest()
        client.event_hooks["request"][0](request)

        assert request.headers["x-trace-id"] == "abc"
        assert request.headers["x-team-id"] == "ck"
        assert request.headers["x-anything-custom"] == "v"


class TestInstallHttpxHookAsync:
    """For httpx.AsyncClient instances the installed hook MUST be an
    async callable; httpx awaits async-client request hooks."""

    def test_async_client_gets_async_hook(self):
        """httpx.AsyncClient -> the installed hook is a coroutine function."""

        async def _run():
            client = httpx.AsyncClient()
            try:
                install_httpx_hook(client)
                hooks = client.event_hooks["request"]
                assert len(hooks) == 1
                hook = hooks[0]
                assert inspect.iscoroutinefunction(hook), (
                    f"AsyncClient must receive an async hook, got sync "
                    f"callable {hook!r}"
                )
            finally:
                await client.aclose()

        asyncio.run(_run())

    def test_async_hook_is_awaitable_and_injects_headers(self):
        """Awaiting the installed async hook must inject forwarded headers."""

        class FakeRequest:
            def __init__(self):
                self.headers = {}

        async def _run():
            client = httpx.AsyncClient()
            try:
                install_httpx_hook(client)
                set_forwarded_headers({"x-aimock-strict": "true"})
                hook = client.event_hooks["request"][0]
                request = FakeRequest()
                # Must be awaitable without TypeError
                result = hook(request)
                assert inspect.isawaitable(result), (
                    "async-client hook must return an awaitable"
                )
                await result
                assert request.headers["x-aimock-strict"] == "true"
            finally:
                await client.aclose()

        asyncio.run(_run())

    def test_sync_client_gets_sync_hook(self):
        """httpx.Client -> the installed hook is a plain sync callable
        (httpx calls request hooks synchronously on a sync client)."""
        client = httpx.Client()
        try:
            install_httpx_hook(client)
            hooks = client.event_hooks["request"]
            assert len(hooks) == 1
            hook = hooks[0]
            assert not inspect.iscoroutinefunction(hook), (
                f"sync Client must receive a sync hook, got coroutine function {hook!r}"
            )
        finally:
            client.close()


class TestInstallHttpxHookRegressions:
    """Regression tests for chain-depth, async/sync MRO heuristic, and
    foreign-hook preservation."""

    def test_chain_depth_exhausted_warns(self):
        """A ``._client`` chain LONGER than the walker's max depth where NO
        node exposes event_hooks must emit a warning (loud-via-warning) and
        not silently no-op."""

        class ChainNode:
            def __init__(self):
                self._client: object | None = None  # filled in below

        # Build a chain of depth well beyond _MAX_CHAIN_DEPTH (5 hops).
        # 10 nodes total, none of which carries event_hooks.
        nodes = [ChainNode() for _ in range(10)]
        for i in range(len(nodes) - 1):
            nodes[i]._client = nodes[i + 1]
        # Terminate the chain at the last node with a non-None, non-event_hooks
        # object so the walker doesn't short-circuit on None.
        nodes[-1]._client = object()

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            install_httpx_hook(nodes[0])
            assert len(w) >= 1
            assert any("event_hooks" in str(item.message) for item in w), (
                f"expected a warning mentioning event_hooks, got {[str(i.message) for i in w]}"
            )

    def test_sync_client_with_async_named_mro_base_is_sync(self):
        """A SYNC duck-typed client whose MRO includes a base class named
        ``Async*`` (but whose own class name is neither ``AsyncClient`` nor
        starts with ``Async``) must be classified as SYNC. An overbroad
        ``startswith("Async")`` MRO heuristic would misclassify it as async
        and install an async hook that httpx calls synchronously -> the
        coroutine is never awaited and headers are silently dropped."""

        class AsyncMixin:
            """A base class whose NAME starts with ``Async`` but which does
            not represent an async client (mirrors e.g. AsyncContextManager
            appearing in MRO)."""

            pass

        class FakeSyncClient(AsyncMixin):
            def __init__(self):
                self.event_hooks = {"request": []}

        client = FakeSyncClient()
        install_httpx_hook(client)
        hooks = client.event_hooks["request"]
        assert len(hooks) == 1
        hook = hooks[0]
        assert not inspect.iscoroutinefunction(hook), (
            f"sync duck-typed client (MRO contains Async*-named base) must "
            f"receive a sync hook, got coroutine function {hook!r}"
        )

    def test_preexisting_foreign_hook_is_preserved(self):
        """If event_hooks['request'] already contains an unrelated callable
        (not carrying our idempotency marker), install_httpx_hook must
        APPEND ours alongside it — not skip installation, not replace the
        foreign hook."""

        def foreign_hook(request):
            # Unrelated pre-existing hook; carries no marker.
            return None

        class FakeClient:
            def __init__(self):
                self.event_hooks = {"request": [foreign_hook]}

        client = FakeClient()
        install_httpx_hook(client)

        hooks = client.event_hooks["request"]
        assert len(hooks) == 2, (
            f"expected foreign hook + ours = 2 hooks, got {len(hooks)}: {hooks!r}"
        )
        # Foreign hook still present and unchanged.
        assert foreign_hook in hooks
        # Exactly one of the two hooks is ours (carries the marker).
        from copilotkit.header_propagation import _HOOK_MARKER

        marked = [h for h in hooks if getattr(h, _HOOK_MARKER, False)]
        assert len(marked) == 1, (
            f"expected exactly one hook to carry our marker, got {len(marked)}"
        )


class TestContextVarIsolation:
    """ContextVar provides proper isolation across contexts."""

    def test_context_isolation(self):
        """Headers set in one context don't leak to another."""
        results = {}

        def task_a():
            set_forwarded_headers({"x-aimock-task": "a"})
            results["a"] = get_forwarded_headers()

        def task_b():
            set_forwarded_headers({"x-aimock-task": "b"})
            results["b"] = get_forwarded_headers()

        # Run in separate contexts to verify isolation
        ctx_a = contextvars.copy_context()
        ctx_b = contextvars.copy_context()

        ctx_a.run(task_a)
        ctx_b.run(task_b)

        assert results["a"] == {"x-aimock-task": "a"}
        assert results["b"] == {"x-aimock-task": "b"}

    def test_child_context_does_not_pollute_parent(self):
        """Setting headers in a child context does not affect the parent."""

        # Ensure clean state in a fresh context
        def _run():
            parent_before = get_forwarded_headers()

            def child():
                set_forwarded_headers({"x-aimock-child": "yes"})

            ctx = contextvars.copy_context()
            ctx.run(child)

            parent_after = get_forwarded_headers()
            assert parent_before == parent_after

        contextvars.copy_context().run(_run)
