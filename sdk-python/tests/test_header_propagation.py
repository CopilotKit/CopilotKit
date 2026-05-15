"""Tests for header propagation (x-* prefixed headers to outgoing LLM calls)."""

import contextvars
import warnings

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
