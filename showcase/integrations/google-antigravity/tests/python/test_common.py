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
    assert endpoint.http_headers == {"X-AIMock-Context": "google-antigravity"}


def test_only_finish_is_enabled():
    from google.antigravity.types import BuiltinTools

    capabilities = _common.chat_only_capabilities()
    # search_web loops without Google credentials and ask_question would park
    # on an interrupt no demo answers; the workspace's file and shell tools
    # stay off on a public deployment.
    assert list(capabilities.enabled_tools) == [BuiltinTools.FINISH]
    assert capabilities.enable_subagents is False
