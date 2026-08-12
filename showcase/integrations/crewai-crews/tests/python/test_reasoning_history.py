"""Red-green tests for multi-turn history threading in the reasoning agent.

Background — the regression these tests pin down:
The previous `_extract_user_input` returned ONLY the last user message's
text, so the chat-completions request was always
``[{system}, {user: <last user text>}]``. Every prior user/assistant turn
was discarded, so follow-up questions lost their conversation context (the
agno reference threads full history via Agno's Agent).

The fix replaces `_extract_user_input` with `_to_chat_messages`, which maps
the full AG-UI message list into the chat-completions `messages` array:
system prompt first, then every prior user/assistant turn in order. tool and
system messages from the input are skipped.

Two CRITICAL constraints these tests pin:
1. For a SINGLE user-message input the result MUST be exactly
   ``[{system}, {user: <text>}]`` — byte-equal to the previous single-turn
   behaviour, because the aimock D6 fixtures replay that exact request.
2. The empty / no-user-message edge preserves the prior behaviour: an empty
   user turn (``[{system}, {user: ""}]``).

The module imports heavy deps (ag_ui, openai, fastapi, starlette) at top
level, so we stub them before import — mirroring the stub pattern in
`test_forwarded_props.py`. Only the pure helper functions
(`_to_chat_messages`, `_coerce_content`) and the module-level `SYSTEM_PROMPT`
are exercised; none of the stubbed surfaces are touched.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import types

import pytest


_STUBBED_MODULE_NAMES = (
    "ag_ui",
    "ag_ui.core",
    "ag_ui.encoder",
    "openai",
    "fastapi",
    "starlette",
    "starlette.endpoints",
    "starlette.requests",
    "starlette.responses",
)


def _install_stubs() -> dict:
    """Stub the heavy top-level imports so `reasoning_agent` imports cheaply.

    Returns a snapshot of the original `sys.modules` entries for every name
    we overwrite, so the fixture can restore them on teardown. Without the
    restore, stubbing shared modules (e.g. `starlette.responses` without
    `PlainTextResponse`) leaks into sibling test modules that import the
    real package and breaks them when this test runs first.
    """
    saved = {name: sys.modules.get(name) for name in _STUBBED_MODULE_NAMES}
    # ag_ui.core — every name the module imports, as bare sentinels.
    ag_ui = types.ModuleType("ag_ui")
    ag_ui.__path__ = []  # mark as package
    ag_ui_core = types.ModuleType("ag_ui.core")
    for name in (
        "BaseEvent",
        "EventType",
        "ReasoningMessageContentEvent",
        "ReasoningMessageEndEvent",
        "ReasoningMessageStartEvent",
        "RunAgentInput",
        "RunErrorEvent",
        "RunFinishedEvent",
        "RunStartedEvent",
        "TextMessageContentEvent",
        "TextMessageEndEvent",
        "TextMessageStartEvent",
    ):
        setattr(ag_ui_core, name, object)
    ag_ui_encoder = types.ModuleType("ag_ui.encoder")
    setattr(ag_ui_encoder, "EventEncoder", object)
    sys.modules["ag_ui"] = ag_ui
    sys.modules["ag_ui.core"] = ag_ui_core
    sys.modules["ag_ui.encoder"] = ag_ui_encoder

    # openai — only `AsyncOpenAI` is referenced (lazily, inside the coroutine).
    openai_mod = types.ModuleType("openai")
    setattr(openai_mod, "AsyncOpenAI", object)
    sys.modules["openai"] = openai_mod

    # fastapi.FastAPI — instantiated at module import for the sub-app.
    fastapi_mod = types.ModuleType("fastapi")

    class _FakeFastAPI:
        def __init__(self, *args, **kwargs):
            pass

        def mount(self, *args, **kwargs):
            pass

    setattr(fastapi_mod, "FastAPI", _FakeFastAPI)
    sys.modules["fastapi"] = fastapi_mod

    # starlette.{endpoints,requests,responses} — bare class sentinels.
    starlette = types.ModuleType("starlette")
    starlette.__path__ = []
    endpoints = types.ModuleType("starlette.endpoints")
    setattr(endpoints, "HTTPEndpoint", object)
    requests = types.ModuleType("starlette.requests")
    setattr(requests, "Request", object)
    responses = types.ModuleType("starlette.responses")
    setattr(responses, "StreamingResponse", object)
    sys.modules["starlette"] = starlette
    sys.modules["starlette.endpoints"] = endpoints
    sys.modules["starlette.requests"] = requests
    sys.modules["starlette.responses"] = responses

    return saved


def _restore_modules(saved: dict) -> None:
    """Restore the original `sys.modules` entries captured by `_install_stubs`.

    A `None` snapshot value means the module was absent before stubbing, so
    we remove our stub entirely rather than leaving a sentinel behind.
    """
    for name, original in saved.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


@pytest.fixture
def reasoning_agent():
    """Load `src/agents/reasoning_agent.py` directly with heavy deps stubbed.

    We load the file by path under a private module name (not `import agents.
    reasoning_agent`) so this test is independent of whatever stub another
    test module may have installed for `agents.reasoning_agent` in
    `sys.modules` (e.g. the autouse fixture in `test_forwarded_props.py`
    leaves an `agents` package sentinel behind).
    """
    saved = _install_stubs()
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.normpath(
        os.path.join(here, "..", "..", "src", "agents", "reasoning_agent.py")
    )
    mod_name = "_reasoning_agent_under_test"
    sys.modules.pop(mod_name, None)
    try:
        spec = importlib.util.spec_from_file_location(mod_name, src)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        yield mod
    finally:
        sys.modules.pop(mod_name, None)
        _restore_modules(saved)


class _Msg:
    """Minimal AG-UI message stand-in (the helper only reads role/content)."""

    def __init__(self, role, content=""):
        self.role = role
        self.content = content


def test_single_user_message_is_byte_equal_to_legacy_shape(reasoning_agent):
    """The aimock-fixture-critical invariant: a single user message must yield
    EXACTLY ``[{system}, {user: <text>}]`` — same bytes as the old
    single-turn `_extract_user_input` path produced."""
    result = reasoning_agent._to_chat_messages([_Msg("user", "What is 2+2?")])
    assert result == [
        {"role": "system", "content": reasoning_agent.SYSTEM_PROMPT},
        {"role": "user", "content": "What is 2+2?"},
    ]


def test_multi_turn_history_is_threaded_in_order(reasoning_agent):
    """All prior user/assistant turns must be threaded in order (the fix) —
    not just the last user message (the regression)."""
    msgs = [
        _Msg("user", "What is 2+2?"),
        _Msg("assistant", "It is 4."),
        _Msg("user", "And times 3?"),
    ]
    result = reasoning_agent._to_chat_messages(msgs)
    assert result == [
        {"role": "system", "content": reasoning_agent.SYSTEM_PROMPT},
        {"role": "user", "content": "What is 2+2?"},
        {"role": "assistant", "content": "It is 4."},
        {"role": "user", "content": "And times 3?"},
    ]


def test_tool_and_system_input_messages_are_skipped(reasoning_agent):
    """Only user/assistant turns are threaded; tool/system input messages are
    dropped so the request stays a clean conversation."""
    msgs = [
        _Msg("system", "ignored input system msg"),
        _Msg("user", "hi"),
        _Msg("tool", "tool result"),
        _Msg("assistant", "hello"),
    ]
    result = reasoning_agent._to_chat_messages(msgs)
    assert result == [
        {"role": "system", "content": reasoning_agent.SYSTEM_PROMPT},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


def test_empty_input_preserves_empty_user_turn(reasoning_agent):
    """No user/assistant turns → ``[{system}, {user: ""}]`` (prior behaviour)."""
    assert reasoning_agent._to_chat_messages([]) == [
        {"role": "system", "content": reasoning_agent.SYSTEM_PROMPT},
        {"role": "user", "content": ""},
    ]
    # Input with only a tool message also falls back to the empty user turn.
    assert reasoning_agent._to_chat_messages([_Msg("tool", "x")]) == [
        {"role": "system", "content": reasoning_agent.SYSTEM_PROMPT},
        {"role": "user", "content": ""},
    ]


def test_multimodal_content_is_coerced_to_joined_text(reasoning_agent):
    """List (multimodal) content joins its text parts — same coercion the old
    `_extract_user_input` applied."""
    msgs = [_Msg("user", [{"text": "part1 "}, {"text": "part2"}])]
    result = reasoning_agent._to_chat_messages(msgs)
    assert result[1] == {"role": "user", "content": "part1 part2"}


def test_none_content_coerces_to_empty_string(reasoning_agent):
    """None content (e.g. an assistant turn carrying only tool calls) coerces
    to an empty string rather than the literal ``None``."""
    assert reasoning_agent._coerce_content(None) == ""
    msgs = [_Msg("user", "q"), _Msg("assistant", None)]
    result = reasoning_agent._to_chat_messages(msgs)
    assert result[2] == {"role": "assistant", "content": ""}
