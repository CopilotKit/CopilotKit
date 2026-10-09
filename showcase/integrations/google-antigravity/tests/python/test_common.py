"""Shared agent wiring in src/agents/_common.py."""

from __future__ import annotations

import pytest

from agents import _common


@pytest.fixture
def clean_env(monkeypatch):
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GEMINI_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_gemini_api_key_wins_over_google_api_key(clean_env):
    clean_env.setenv("GEMINI_API_KEY", "gemini")
    clean_env.setenv("GOOGLE_API_KEY", "google")
    assert _common.api_key() == "gemini"


def test_google_api_key_is_the_fallback(clean_env):
    # The fleet exports GOOGLE_API_KEY; the Antigravity SDK only reads GEMINI_API_KEY.
    clean_env.setenv("GOOGLE_API_KEY", "google")
    assert _common.api_key() == "google"


def test_no_base_url_means_google_api(clean_env):
    assert _common.gemini_base_url() is None
    assert _common.endpoint() is None


@pytest.mark.parametrize("base", ["http://aimock:4010", "http://aimock:4010/"])
def test_base_url_builds_an_aimock_endpoint(clean_env, base):
    clean_env.setenv("GOOGLE_GEMINI_BASE_URL", base)
    clean_env.setenv("GOOGLE_API_KEY", "fake-gemini-key")
    endpoint = _common.endpoint()
    assert endpoint.base_url == "http://aimock:4010"
    assert endpoint.api_key == "fake-gemini-key"
    # The harness makes the model calls, so the fixture selector must ride
    # on the endpoint.
    assert endpoint.http_headers == {"x-aimock-context": "google-antigravity"}


def test_only_finish_is_enabled():
    from google.antigravity.types import BuiltinTools

    capabilities = _common.chat_only_capabilities()
    # search_web loops without Google credentials and ask_question would park
    # on an interrupt no demo answers; the workspace's file and shell tools
    # stay off on a public deployment.
    assert list(capabilities.enabled_tools) == [BuiltinTools.FINISH]
    assert capabilities.enable_subagents is False


def test_every_agent_gets_the_tool_call_limit(monkeypatch, tmp_path):
    # Bounds a turn that never stops calling tools; a turn outlives its client,
    # so nothing else would stop it (PNI-570/PNI-571).
    monkeypatch.setattr(_common, "WORKSPACE", str(tmp_path / "ws"))
    monkeypatch.setattr(_common, "SAVE_DIR", str(tmp_path / "sessions"))
    monkeypatch.setattr(_common, "_DIRS_READY", False)

    agent = _common.build()

    assert _common.MAX_TOOL_CALLS_PER_TURN == 50
    assert agent._max_tool_calls_per_turn == 50


class TestForwardedModelHeaders:
    """PNI-576: the request's mock and diagnostic headers reach the model call."""

    @pytest.fixture(autouse=True)
    def _no_leaked_headers(self):
        # set_forwarded_headers writes a ContextVar; in a sync test that value
        # would otherwise outlive the test and leak into later ones.
        from agents._header_forwarding import set_forwarded_headers

        yield
        set_forwarded_headers({})

    def test_strict_and_diagnostic_headers_are_forwarded(self):
        from agents._header_forwarding import set_forwarded_headers

        set_forwarded_headers(
            {
                "X-AIMock-Strict": "true",
                "x-test-id": "d6-google-antigravity-123",
                "x-diag-run-id": "run-123",
                "x-diag-hops": "harness,route",
                "x-forwarded-for": "10.0.0.1",
            }
        )

        headers = _common.aimock_headers()

        assert headers["x-aimock-strict"] == "true"
        assert headers["x-test-id"] == "d6-google-antigravity-123"
        assert headers["x-diag-run-id"] == "run-123"
        assert headers["x-diag-hops"] == "harness,route"
        assert "x-forwarded-for" not in headers

    def test_the_fixture_context_cannot_be_overridden_by_the_request(self):
        from agents._header_forwarding import set_forwarded_headers

        set_forwarded_headers({"x-aimock-context": "some-other-integration"})

        assert _common.aimock_headers()["x-aimock-context"] == "google-antigravity"

    def test_plain_demo_traffic_gets_only_the_context(self):
        from agents._header_forwarding import set_forwarded_headers

        set_forwarded_headers({})

        assert _common.aimock_headers() == {"x-aimock-context": "google-antigravity"}

    def test_the_endpoint_carries_them(self, clean_env):
        from agents._header_forwarding import set_forwarded_headers

        clean_env.setenv("GOOGLE_GEMINI_BASE_URL", "http://aimock:4010")
        set_forwarded_headers({"x-aimock-strict": "true"})

        endpoint = _common.endpoint()

        assert endpoint.http_headers == {
            "x-aimock-strict": "true",
            "x-aimock-context": "google-antigravity",
        }

    def test_the_factory_passes_the_endpoint_as_a_callable(self, monkeypatch, tmp_path):
        # Resolved per session by the adapter, inside the request that builds
        # it -- a value computed here at import time would carry no headers.
        monkeypatch.setattr(_common, "WORKSPACE", str(tmp_path / "ws"))
        monkeypatch.setattr(_common, "SAVE_DIR", str(tmp_path / "sessions"))
        monkeypatch.setattr(_common, "_DIRS_READY", False)

        agent = _common.build()

        assert agent._endpoint is _common.endpoint
