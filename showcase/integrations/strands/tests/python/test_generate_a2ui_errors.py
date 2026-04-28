"""Tests for the hardened ``generate_a2ui`` error-handling surface.

Mirrors the google-adk sibling agent's hardening pattern: every failure
branch returns a structured ``{error, message, remediation}`` dict
(JSON-serialized, since the strands tool returns a string) instead of
letting raw OpenAI exceptions bubble up through the strands tool
machinery.

Covers:
  * OpenAI APIError / RateLimitError / APIConnectionError / AuthenticationError
  * Empty ``response.choices``
  * Empty / missing ``tool_calls[0]``
  * Malformed ``json.loads(tool_call.function.arguments)``
"""

from __future__ import annotations

import json
import sys
import types
from types import SimpleNamespace

import pytest


# ---- Fake ``openai`` module ---------------------------------------------
#
# The real ``openai`` package may not be installed in the test venv. We
# install a stub that provides the exception classes used in the except
# branches and an ``OpenAI`` class whose ``chat.completions.create`` we
# patch per-test via monkeypatch.


def _install_openai_stub():
    if "openai" in sys.modules:
        return
    m = types.ModuleType("openai")

    class OpenAIError(Exception):
        """Base class for all openai-SDK errors. Matches the real SDK's hierarchy."""
        pass

    class APIError(OpenAIError):
        pass

    class RateLimitError(APIError):
        pass

    class APIConnectionError(APIError):
        pass

    class AuthenticationError(APIError):
        pass

    # Placeholder OpenAI client; tests replace ``OpenAI`` on the module
    # with a class that returns whatever ``chat.completions.create`` we want.
    class OpenAI:
        def __init__(self, *a, **kw):
            raise AssertionError("tests must override openai.OpenAI")

    m.OpenAIError = OpenAIError
    m.APIError = APIError
    m.RateLimitError = RateLimitError
    m.APIConnectionError = APIConnectionError
    m.AuthenticationError = AuthenticationError
    m.OpenAI = OpenAI
    sys.modules["openai"] = m


def _install_httpx_stub():
    if "httpx" in sys.modules:
        return
    m = types.ModuleType("httpx")

    class HTTPError(Exception):
        """Base class for all httpx transport errors."""
        pass

    class ConnectError(HTTPError):
        pass

    class ReadTimeout(HTTPError):
        pass

    m.HTTPError = HTTPError
    m.ConnectError = ConnectError
    m.ReadTimeout = ReadTimeout
    sys.modules["httpx"] = m


_install_openai_stub()
_install_httpx_stub()


# ---- Helpers ------------------------------------------------------------


def _make_fake_openai_client(*, create_behavior):
    """Build a fake ``OpenAI`` class whose ``chat.completions.create``
    invokes ``create_behavior(**kwargs)``.

    ``create_behavior`` may either raise (to simulate an API failure) or
    return a ``SimpleNamespace`` standing in for the OpenAI response.
    """

    class _FakeCompletions:
        def create(self, **kwargs):
            return create_behavior(**kwargs)

    class _FakeChat:
        def __init__(self):
            self.completions = _FakeCompletions()

    class _FakeOpenAI:
        def __init__(self, *a, **kw):
            self.chat = _FakeChat()

    return _FakeOpenAI


def _response_with_tool_args(args_json: str):
    """Build a fake OpenAI response whose first tool call has the given JSON args."""
    tool_call = SimpleNamespace(function=SimpleNamespace(arguments=args_json))
    message = SimpleNamespace(tool_calls=[tool_call])
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


def _response_with_no_tool_calls():
    message = SimpleNamespace(tool_calls=[])
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


def _response_with_no_choices():
    return SimpleNamespace(choices=[])


def _invoke_generate_a2ui(context: str = "test context"):
    """Call ``generate_a2ui`` on the module and return the parsed result.

    The ``@tool`` decorator in the conftest stub is a no-op, so the
    underlying function is directly callable.
    """
    from agents.agent import generate_a2ui

    raw = generate_a2ui(context)
    return json.loads(raw)


# ---- Tests --------------------------------------------------------------


@pytest.mark.parametrize(
    "exc_name",
    ["APIError", "RateLimitError", "APIConnectionError", "AuthenticationError"],
)
def test_openai_exceptions_return_structured_error(monkeypatch, exc_name):
    """OpenAI exception subclasses must be caught and returned as a
    structured ``{error, message, remediation}`` payload, not raised.

    We construct a subclass of the real openai exception class that
    accepts a bare message — the real classes have varied/restrictive
    constructors (e.g. ``AuthenticationError`` requires ``response`` +
    ``body`` kwargs). The subclass keeps ``isinstance(exc, openai.APIError)``
    true so the except branch in ``generate_a2ui`` catches it the same
    way, while letting the test instantiate without provider SDK internals.
    """
    import openai

    base_cls = getattr(openai, exc_name)

    # Build a lightweight subclass that carries the bare string message.
    TestExc = type(f"Test{exc_name}", (base_cls,), {
        "__init__": lambda self, msg: Exception.__init__(self, msg),
    })

    def _raise(**_kwargs):
        raise TestExc(f"simulated {exc_name}")

    FakeOpenAI = _make_fake_openai_client(create_behavior=_raise)
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_llm_error"
    # The message carries the subclass name, which includes the parent
    # exception name as a substring.
    assert exc_name in result["message"]
    assert "remediation" in result
    assert "OPENAI_API_KEY" in result["remediation"]


def test_empty_choices_returns_structured_error(monkeypatch):
    import openai

    FakeOpenAI = _make_fake_openai_client(
        create_behavior=lambda **_: _response_with_no_choices()
    )
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_empty_response"
    assert "no choices" in result["message"].lower()
    assert result["remediation"]


def test_missing_tool_calls_returns_structured_error(monkeypatch):
    import openai

    FakeOpenAI = _make_fake_openai_client(
        create_behavior=lambda **_: _response_with_no_tool_calls()
    )
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_no_tool_call"
    assert "render_a2ui" in result["message"]
    assert result["remediation"]


def test_malformed_tool_args_returns_structured_error(monkeypatch):
    import openai

    FakeOpenAI = _make_fake_openai_client(
        create_behavior=lambda **_: _response_with_tool_args("{not valid json"),
    )
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_invalid_arguments"
    assert "parse" in result["message"].lower() or "arguments" in result["message"].lower()
    assert result["remediation"]


def test_openai_base_error_returns_structured(monkeypatch):
    """``OpenAIError`` is the base class the SDK raises from the
    ``OpenAI()`` constructor when the API key is missing or malformed —
    it is NOT a subclass of ``APIError``. The except clause must catch
    ``OpenAIError`` (or broader) so config-time failures become a
    structured tool result, not an uncaught exception.
    """
    import openai

    class _ConfigError(openai.OpenAIError):
        def __init__(self, msg):
            Exception.__init__(self, msg)

    def _raise(**_kwargs):
        raise _ConfigError("simulated missing/malformed API key")

    FakeOpenAI = _make_fake_openai_client(create_behavior=_raise)
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_llm_error"
    assert "ConfigError" in result["message"] or "OpenAIError" in result["message"]
    assert "OPENAI_API_KEY" in result["remediation"]


def test_openai_constructor_openai_error_caught(monkeypatch):
    """Analog of the above but the ``OpenAIError`` is raised from the
    ``OpenAI()`` constructor itself (missing env var path). The client
    construction must sit inside the try block; otherwise the error
    bypasses the except clause and escapes.
    """
    import openai

    class _ConstructorError(openai.OpenAIError):
        def __init__(self, msg):
            Exception.__init__(self, msg)

    class _FailingOpenAI:
        def __init__(self, *a, **kw):
            raise _ConstructorError("OPENAI_API_KEY must be set")

    monkeypatch.setattr(openai, "OpenAI", _FailingOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_llm_error"
    assert "ConstructorError" in result["message"] or "OpenAIError" in result["message"]


def test_httpx_transport_error_returns_structured(monkeypatch):
    """``httpx.HTTPError`` (and subclasses like ``ConnectError`` /
    ``ReadTimeout``) can escape below the OpenAI SDK's wrap layer in some
    failure modes. The except clause must catch them so transport
    failures surface as a structured tool result.
    """
    import httpx
    import openai

    def _raise(**_kwargs):
        raise httpx.ConnectError("simulated DNS failure")

    FakeOpenAI = _make_fake_openai_client(create_behavior=_raise)
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    result = _invoke_generate_a2ui()

    assert result["error"] == "a2ui_llm_error"
    assert "ConnectError" in result["message"]
    assert result["remediation"]


def test_happy_path_returns_a2ui_operations(monkeypatch):
    """Sanity check: a well-formed response goes through
    ``build_a2ui_operations_from_tool_call`` and returns a non-error payload."""
    import openai

    valid_args = json.dumps({
        "surfaceId": "test-surface",
        "catalogId": "test-catalog",
        "components": [],
        "data": {},
    })
    FakeOpenAI = _make_fake_openai_client(
        create_behavior=lambda **_: _response_with_tool_args(valid_args),
    )
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    # Stub build_a2ui_operations_from_tool_call to return a marker payload
    # so we don't depend on the shared tool's real implementation shape.
    import agents.agent as agent_mod

    monkeypatch.setattr(
        agent_mod,
        "build_a2ui_operations_from_tool_call",
        lambda args: {"a2ui_marker": True, "surfaceId": args.get("surfaceId")},
    )

    result = _invoke_generate_a2ui()

    assert "error" not in result
    assert result.get("a2ui_marker") is True
    assert result.get("surfaceId") == "test-surface"
