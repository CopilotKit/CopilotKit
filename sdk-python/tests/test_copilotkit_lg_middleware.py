"""Behavior tests for ``CopilotKitMiddleware``.

The contract these tests pin down (independent of how the middleware is
implemented internally — we only assert on what the model/handler observes
and what state updates the middleware emits):

* Frontend tools listed in ``state["copilotkit"]["actions"]`` show up alongside
  the agent's own tools when the model is called. When there are no frontend
  tools the request reaches the model unchanged.
* App context from ``state["copilotkit"]["context"]`` (or ``runtime.context``)
  becomes a ``SystemMessage`` containing ``"App Context:\\n<json>"``. Empty
  context is a no-op. Re-running ``before_agent`` does not duplicate the note.
* ``after_model`` peels frontend tool calls off the last AIMessage so the
  ToolNode does not try to execute them; ``after_agent`` re-attaches them
  before the run ends.
* The ``expose_state`` opt-in surfaces user state into ``request.system_message``
  as a ``"Current agent state:"`` note. Default is off; reserved internal
  keys, underscore-prefixed keys, and empty values are filtered out; an
  allowlist forces an explicit subset; any existing system message is kept
  and the note appended to it.
* The Bedrock checkpoint normalizer drops orphan tool calls and dedupes
  ToolMessages that share a ``tool_call_id``.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain.agents.middleware import ModelRequest

from copilotkit.copilotkit_lg_middleware import (
    CopilotKitMiddleware,
    _extract_forwarded_headers_from_config,
)
from copilotkit.header_propagation import get_forwarded_headers, set_forwarded_headers


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_request(
    *,
    state: dict[str, Any] | None = None,
    tools: list[Any] | None = None,
    system_message: SystemMessage | None = None,
    messages: list[Any] | None = None,
) -> ModelRequest:
    """Build a ModelRequest with sensible defaults for testing."""
    return ModelRequest(
        model=MagicMock(name="model"),
        messages=messages if messages is not None else [],
        system_message=system_message,
        tools=tools if tools is not None else [],
        state=state if state is not None else {"messages": []},
        runtime=MagicMock(name="runtime"),
    )


class _CapturingHandler:
    """Records the request handed to the model wrapper."""

    def __init__(self) -> None:
        self.received: ModelRequest | None = None

    def __call__(self, request: ModelRequest) -> str:
        self.received = request
        return "model-response"


def _run_wrap(middleware: CopilotKitMiddleware, request: ModelRequest):
    """Invoke the sync wrap_model_call with a capturing handler."""
    handler = _CapturingHandler()
    result = middleware.wrap_model_call(request, handler)
    assert handler.received is not None, "handler must be called"
    return handler.received, result


# ---------------------------------------------------------------------------
# Frontend-tool injection
# ---------------------------------------------------------------------------


def test_no_frontend_tools_passes_request_through_unchanged():
    middleware = CopilotKitMiddleware()
    backend_tool = {"name": "backend_tool"}
    request = _make_request(state={"messages": []}, tools=[backend_tool])

    seen, _ = _run_wrap(middleware, request)

    assert seen.tools == [backend_tool]


def test_frontend_tools_appended_to_existing_tools():
    middleware = CopilotKitMiddleware()
    backend_tool = {"name": "backend_tool"}
    fe_tools = [{"name": "fe_one"}, {"name": "fe_two"}]
    request = _make_request(
        state={"messages": [], "copilotkit": {"actions": fe_tools}},
        tools=[backend_tool],
    )

    seen, _ = _run_wrap(middleware, request)

    seen_names = [t["name"] for t in seen.tools]
    assert "backend_tool" in seen_names
    assert seen_names.count("fe_one") == 1
    assert seen_names.count("fe_two") == 1


def test_frontend_tools_merge_does_not_mutate_input_request():
    middleware = CopilotKitMiddleware()
    request = _make_request(
        state={"messages": [], "copilotkit": {"actions": [{"name": "fe"}]}},
        tools=[{"name": "backend"}],
    )

    _run_wrap(middleware, request)

    # The override(...) contract is to return a fresh request — the original
    # tools list must not have grown.
    assert [t["name"] for t in request.tools] == ["backend"]


# ---------------------------------------------------------------------------
# expose_state — opt-in state surfacing
# ---------------------------------------------------------------------------


def test_expose_state_default_is_off():
    middleware = CopilotKitMiddleware()
    request = _make_request(state={"messages": [], "liked": ["a", "b"]})

    seen, _ = _run_wrap(middleware, request)

    assert seen.system_message is None


def test_expose_state_true_surfaces_user_keys_into_system_message():
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(state={"messages": [], "liked": ["a", "b"]})

    seen, _ = _run_wrap(middleware, request)

    assert seen.system_message is not None
    body = seen.system_message.content
    assert isinstance(body, str)
    assert "Current agent state:" in body
    assert '"liked"' in body
    assert '"a"' in body
    assert '"b"' in body


def test_expose_state_true_skips_reserved_internal_keys():
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(
        state={
            "messages": [HumanMessage("hi")],
            "tools": [{"name": "x"}],
            "copilotkit": {"actions": []},
            "structured_response": {"foo": "bar"},
            "thread_id": "t-1",
            "remaining_steps": 5,
            "ag-ui": {"context": []},
            "liked": ["a"],
        }
    )

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content if seen.system_message else ""
    # Only the user key escapes the reserved filter.
    assert '"liked"' in body
    for reserved in (
        "messages",
        "tools",
        "copilotkit",
        "structured_response",
        "thread_id",
        "remaining_steps",
        "ag-ui",
    ):
        assert f'"{reserved}"' not in body, f"reserved key {reserved} leaked"


def test_expose_state_true_skips_underscore_prefixed_keys():
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(
        state={"messages": [], "_internal": {"secret": 1}, "visible": "ok"}
    )

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content if seen.system_message else ""
    assert '"_internal"' not in body
    assert '"visible"' in body


@pytest.mark.parametrize("empty_value", [None, "", [], {}])
def test_expose_state_skips_empty_values(empty_value):
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(
        state={"messages": [], "filled": ["x"], "blank": empty_value}
    )

    seen, _ = _run_wrap(middleware, request)

    if seen.system_message is None:
        # Acceptable: nothing left to surface after dropping the empty key.
        return
    body = seen.system_message.content
    assert '"filled"' in body
    assert '"blank"' not in body


def test_expose_state_no_message_when_only_reserved_keys_present():
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(state={"messages": [HumanMessage("hi")], "tools": []})

    seen, _ = _run_wrap(middleware, request)

    assert seen.system_message is None


def test_expose_state_allowlist_only_includes_named_keys():
    middleware = CopilotKitMiddleware(expose_state=["liked"])
    request = _make_request(
        state={"messages": [], "liked": ["a"], "todos": [{"id": 1}], "other": "x"}
    )

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content if seen.system_message else ""
    assert '"liked"' in body
    assert '"todos"' not in body
    assert '"other"' not in body


def test_expose_state_allowlist_can_override_reserved_keys():
    """If the user explicitly lists a reserved key, honor their intent."""
    middleware = CopilotKitMiddleware(expose_state=["thread_id"])
    request = _make_request(state={"messages": [], "thread_id": "t-42"})

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content if seen.system_message else ""
    assert "t-42" in body


def test_expose_state_appends_to_existing_system_message():
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(
        state={"messages": [], "liked": ["a"]},
        system_message=SystemMessage(content="You are a helpful assistant."),
    )

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content
    assert isinstance(body, str)
    assert "You are a helpful assistant." in body
    assert "Current agent state:" in body
    # Ordering: original prompt comes first, note follows.
    assert body.index("You are a helpful assistant.") < body.index(
        "Current agent state:"
    )


def test_expose_state_false_explicitly_keeps_state_hidden():
    middleware = CopilotKitMiddleware(expose_state=False)
    request = _make_request(
        state={"messages": [], "liked": ["a"]},
        system_message=SystemMessage(content="base"),
    )

    seen, _ = _run_wrap(middleware, request)

    assert seen.system_message is not None
    assert seen.system_message.content == "base"


def test_expose_state_emits_valid_json_payload():
    """The 'Current agent state:' body parses cleanly as JSON."""
    middleware = CopilotKitMiddleware(expose_state=True)
    state = {"messages": [], "liked": ["a", "b"], "count": 3, "nested": {"k": "v"}}
    request = _make_request(state=state)

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content
    json_part = body.split("Current agent state:\n", 1)[1]
    parsed = json.loads(json_part)
    assert parsed == {"liked": ["a", "b"], "count": 3, "nested": {"k": "v"}}


def test_expose_state_true_never_surfaces_forwarded_headers():
    """``copilotkit_forwarded_headers`` is a transport-layer plumbing key — it
    must NEVER reach the LLM prompt via the ``expose_state`` path either, even
    when ``expose_state=True`` would otherwise serialize every non-reserved
    top-level state key.
    """
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(
        state={
            "messages": [],
            "liked": ["a"],
            "copilotkit_forwarded_headers": {
                "x-aimock-context": "showcase/d6",
                "x-aimock-strict": "true",
            },
        }
    )

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content if seen.system_message else ""
    # The genuine user key is still surfaced.
    assert '"liked"' in body
    # The transport-layer wrapper and its header values are not.
    assert "copilotkit_forwarded_headers" not in body, (
        "copilotkit_forwarded_headers must never appear in expose_state output"
    )
    assert "x-aimock-context" not in body, (
        "forwarded header values must never appear in expose_state output"
    )
    assert "x-aimock-strict" not in body
    assert "showcase/d6" not in body


def test_expose_state_allowlist_never_surfaces_forwarded_headers():
    """``copilotkit_forwarded_headers`` must NEVER reach the LLM prompt via the
    ``expose_state`` path — including the explicit allowlist form. The sibling
    ``test_expose_state_allowlist_can_override_reserved_keys`` pins that users
    CAN allowlist other reserved keys (e.g. ``thread_id``) on purpose; this key
    is the one exception, because it is a transport-layer wrapper for forwarded
    request headers and rendering it would leak the raw headers into the prompt.
    """
    middleware = CopilotKitMiddleware(
        expose_state=frozenset({"copilotkit_forwarded_headers"})
    )
    request = _make_request(
        state={
            "messages": [],
            "copilotkit_forwarded_headers": {
                "x-aimock-context": "showcase/d6",
                "x-aimock-strict": "true",
            },
        }
    )

    seen, _ = _run_wrap(middleware, request)

    body = seen.system_message.content if seen.system_message else ""
    assert "copilotkit_forwarded_headers" not in body, (
        "copilotkit_forwarded_headers must never appear in allowlist output"
    )
    assert "x-aimock-context" not in body, (
        "forwarded header values must never appear in allowlist output"
    )
    assert "x-aimock-strict" not in body
    assert "showcase/d6" not in body


# ---------------------------------------------------------------------------
# Async wrapper parity
# ---------------------------------------------------------------------------


def test_async_wrap_mirrors_sync_behavior_for_state_and_tools():
    """The async path applies the same state/tool augmentations as the sync one."""
    middleware = CopilotKitMiddleware(expose_state=True)
    request = _make_request(
        state={
            "messages": [],
            "copilotkit": {"actions": [{"name": "fe"}]},
            "liked": ["a"],
        },
        tools=[{"name": "backend"}],
    )

    received: dict[str, ModelRequest] = {}

    async def handler(req: ModelRequest):
        received["req"] = req
        return "ok"

    async def go():
        return await middleware.awrap_model_call(request, handler)

    result = asyncio.run(go())

    seen = received["req"]
    assert result == "ok"
    assert {t["name"] for t in seen.tools} == {"backend", "fe"}
    assert seen.system_message is not None
    assert "Current agent state:" in seen.system_message.content


# ---------------------------------------------------------------------------
# before_agent — App Context injection
# ---------------------------------------------------------------------------


def _system_contents(messages: list[Any]) -> list[str]:
    return [
        m.content if isinstance(m.content, str) else str(m.content)
        for m in messages
        if isinstance(m, SystemMessage)
    ]


def test_before_agent_no_context_returns_no_update():
    middleware = CopilotKitMiddleware()
    state = {"messages": [HumanMessage("hi")], "copilotkit": {}}
    runtime = MagicMock(name="runtime", context=None)

    result = middleware.before_agent(state, runtime)

    assert result is None


def test_before_agent_injects_app_context_system_message():
    middleware = CopilotKitMiddleware()
    state = {
        "messages": [HumanMessage("hi")],
        "copilotkit": {"context": [{"description": "viewer role", "value": "admin"}]},
    }
    runtime = MagicMock(name="runtime", context=None)

    result = middleware.before_agent(state, runtime)

    assert result is not None
    sys_contents = _system_contents(result["messages"])
    assert any("App Context:" in s for s in sys_contents)
    assert any("admin" in s for s in sys_contents)


def test_before_agent_idempotent_does_not_duplicate_context():
    middleware = CopilotKitMiddleware()
    state = {
        "messages": [HumanMessage("hi")],
        "copilotkit": {"context": [{"description": "k", "value": "v"}]},
    }
    runtime = MagicMock(name="runtime", context=None)

    first = middleware.before_agent(state, runtime) or state
    second = middleware.before_agent(first, runtime) or first

    sys_messages = [m for m in second["messages"] if isinstance(m, SystemMessage)]
    app_context_messages = [
        m
        for m in sys_messages
        if isinstance(m.content, str) and m.content.startswith("App Context:")
    ]
    assert len(app_context_messages) == 1


def test_before_agent_uses_runtime_context_when_state_context_empty():
    middleware = CopilotKitMiddleware()
    state = {"messages": [HumanMessage("hi")], "copilotkit": {}}
    runtime = MagicMock(name="runtime", context="route=/dashboard")

    result = middleware.before_agent(state, runtime)

    assert result is not None
    sys_contents = _system_contents(result["messages"])
    assert any("/dashboard" in s for s in sys_contents)


def test_before_agent_strips_copilotkit_forwarded_headers_from_runtime_context():
    """``copilotkit_forwarded_headers`` is a transport-layer plumbing key that
    langgraph-api auto-copies from ``configurable`` into ``context``. It must
    never be rendered into the LLM prompt as App Context — the forwarded-headers
    httpx conveyance path reads it from a separate ContextVar.

    When that key is the ONLY thing in ``runtime.context``, ``before_agent``
    must treat it as empty App Context and not inject an "App Context:" system
    message at all.
    """
    middleware = CopilotKitMiddleware()
    state = {"messages": [HumanMessage("hi")], "copilotkit": {}}
    runtime = MagicMock(
        name="runtime",
        context={
            "copilotkit_forwarded_headers": {
                "x-aimock-context": "showcase/d6",
                "x-aimock-strict": "true",
            }
        },
    )

    result = middleware.before_agent(state, runtime)

    # Contract: when ``runtime.context`` contains ONLY
    # ``copilotkit_forwarded_headers``, the strip leaves an empty App Context,
    # so ``before_agent`` MUST short-circuit and return None (no App Context
    # system message). A non-None result here means the strip regressed and
    # the transport-layer wrapper is being injected into the prompt.
    #
    # NOTE: an earlier version of this test guarded the leak assertions with
    # ``if result is not None``, which silently passed if the strip stopped
    # short-circuiting — exactly the regression we need to catch. Assert
    # explicitly instead.
    assert result is None, (
        "expected short-circuit (no App Context message) when only "
        "copilotkit_forwarded_headers is present in runtime.context"
    )


def test_before_agent_strips_forwarded_headers_but_keeps_real_app_context():
    """When ``runtime.context`` contains both a genuine app key AND the
    transport-only ``copilotkit_forwarded_headers`` wrapper, the App Context
    system message must still be injected with the real key, but the forwarded
    headers must be filtered out.
    """
    middleware = CopilotKitMiddleware()
    state = {"messages": [HumanMessage("hi")], "copilotkit": {}}
    runtime = MagicMock(
        name="runtime",
        context={
            "user_tier": "pro",
            "copilotkit_forwarded_headers": {
                "x-aimock-context": "showcase/d6",
            },
        },
    )

    result = middleware.before_agent(state, runtime)

    assert result is not None
    sys_contents = _system_contents(result["messages"])
    # The genuine app context is still surfaced.
    assert any("App Context:" in s for s in sys_contents)
    assert any("user_tier" in s and "pro" in s for s in sys_contents)
    # The transport-layer wrapper is stripped from the rendered prompt.
    assert not any("copilotkit_forwarded_headers" in s for s in sys_contents), (
        "copilotkit_forwarded_headers must be filtered out of the App Context message"
    )
    assert not any("x-aimock-context" in s for s in sys_contents), (
        "forwarded header values must never appear in a system prompt"
    )


# ---------------------------------------------------------------------------
# after_model — frontend tool-call interception
# ---------------------------------------------------------------------------


def test_after_model_no_frontend_tools_is_noop():
    middleware = CopilotKitMiddleware()
    state = {
        "messages": [
            HumanMessage("hi"),
            AIMessage(
                content="",
                tool_calls=[{"id": "1", "name": "backend_only", "args": {}}],
            ),
        ],
        "copilotkit": {"actions": []},
    }
    runtime = MagicMock(name="runtime")

    assert middleware.after_model(state, runtime) is None


def test_after_model_intercepts_frontend_tool_calls_and_leaves_backend_alone():
    middleware = CopilotKitMiddleware()
    fe_tool = {"function": {"name": "navigate"}}
    backend_call = {"id": "1", "name": "backend_search", "args": {"q": "hi"}}
    frontend_call = {"id": "2", "name": "navigate", "args": {"path": "/x"}}
    ai = AIMessage(
        content="",
        tool_calls=[backend_call, frontend_call],
        id="ai-1",
    )
    state = {
        "messages": [HumanMessage("hi"), ai],
        "copilotkit": {"actions": [fe_tool]},
    }
    runtime = MagicMock(name="runtime")

    result = middleware.after_model(state, runtime)

    assert result is not None
    last = result["messages"][-1]
    assert isinstance(last, AIMessage)
    assert [tc["name"] for tc in last.tool_calls] == ["backend_search"]
    intercepted = result["copilotkit"]["intercepted_tool_calls"]
    assert len(intercepted) == 1
    assert intercepted[0]["id"] == "2"
    assert intercepted[0]["name"] == "navigate"
    assert intercepted[0]["args"] == {"path": "/x"}
    assert result["copilotkit"]["original_ai_message_id"] == "ai-1"


# ---------------------------------------------------------------------------
# after_agent — frontend tool-call restoration
# ---------------------------------------------------------------------------


def test_after_agent_no_intercepted_returns_no_update():
    middleware = CopilotKitMiddleware()
    state = {
        "messages": [HumanMessage("hi"), AIMessage(content="ok", id="ai-1")],
        "copilotkit": {},
    }
    runtime = MagicMock(name="runtime")

    assert middleware.after_agent(state, runtime) is None


def test_after_agent_restores_intercepted_tool_calls_on_original_message():
    middleware = CopilotKitMiddleware()
    intercepted = [{"id": "2", "name": "navigate", "args": {"path": "/x"}}]
    state = {
        "messages": [
            HumanMessage("hi"),
            AIMessage(content="", id="ai-1"),
        ],
        "copilotkit": {
            "intercepted_tool_calls": intercepted,
            "original_ai_message_id": "ai-1",
        },
    }
    runtime = MagicMock(name="runtime")

    result = middleware.after_agent(state, runtime)

    assert result is not None
    restored_ai = next(
        m for m in result["messages"] if isinstance(m, AIMessage) and m.id == "ai-1"
    )
    assert [tc["name"] for tc in restored_ai.tool_calls] == ["navigate"]
    assert result["copilotkit"]["intercepted_tool_calls"] is None
    assert result["copilotkit"]["original_ai_message_id"] is None


# ---------------------------------------------------------------------------
# Bedrock checkpoint normalizer — message-list contract
# ---------------------------------------------------------------------------


def test_bedrock_fix_strips_unanswered_tool_calls_from_ai_message():
    ai = AIMessage(
        content="",
        tool_calls=[
            {"id": "answered", "name": "search", "args": {}},
            {"id": "orphan", "name": "search", "args": {}},
        ],
        id="ai-1",
    )
    answered = ToolMessage(content="result", tool_call_id="answered")
    messages: list[Any] = [HumanMessage("hi"), ai, answered]

    CopilotKitMiddleware._fix_messages_for_bedrock(messages)

    repaired_ai = next(m for m in messages if isinstance(m, AIMessage))
    assert [tc["id"] for tc in repaired_ai.tool_calls] == ["answered"]


def test_bedrock_fix_dedupes_tool_messages_with_shared_id():
    """Real result wins over an interrupted placeholder for the same id."""
    ai = AIMessage(
        content="",
        tool_calls=[{"id": "tc-1", "name": "search", "args": {}}],
        id="ai-1",
    )
    placeholder = ToolMessage(
        content="Tool call 'search' with id 'tc-1' was interrupted before completion.",
        tool_call_id="tc-1",
    )
    real = ToolMessage(content='{"hits": 3}', tool_call_id="tc-1")
    messages: list[Any] = [HumanMessage("hi"), ai, placeholder, real]

    CopilotKitMiddleware._fix_messages_for_bedrock(messages)

    tool_messages = [m for m in messages if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 1
    assert tool_messages[0].content == '{"hits": 3}'


def test_bedrock_fix_repairs_string_args_to_dicts():
    # Construct cleanly, then corrupt the args to simulate what
    # checkpoints sometimes produce (str instead of dict).
    ai = AIMessage(
        content="",
        tool_calls=[{"id": "tc-1", "name": "search", "args": {}}],
        id="ai-1",
    )
    ai.tool_calls[0]["args"] = '{"q": "hello"}'
    answered = ToolMessage(content="ok", tool_call_id="tc-1")
    messages: list[Any] = [HumanMessage("hi"), ai, answered]

    CopilotKitMiddleware._fix_messages_for_bedrock(messages)

    repaired = next(m for m in messages if isinstance(m, AIMessage))
    assert repaired.tool_calls[0]["args"] == {"q": "hello"}


# ---------------------------------------------------------------------------
# _extract_forwarded_headers_from_config — raw x-* header extraction
# ---------------------------------------------------------------------------


class TestExtractForwardedHeadersFromConfig:
    """Verify that raw x-* keys on config["configurable"] and config["context"]
    are extracted and pushed into the header-propagation ContextVar."""

    def _patch_get_config(self, monkeypatch, config: dict):
        """Patch langgraph.config.get_config to return *config*."""
        monkeypatch.setattr(
            "copilotkit.copilotkit_lg_middleware.get_config",
            lambda: config,
            raising=False,
        )
        # Also patch at the import site inside the function's local scope:
        # _extract_forwarded_headers_from_config does a local import, so we
        # need to patch the module it imports from.
        import langgraph.config as _lg_config

        monkeypatch.setattr(_lg_config, "get_config", lambda: config)

    def setup_method(self):
        """Reset forwarded headers before each test."""
        set_forwarded_headers({})

    def test_raw_x_header_on_configurable_is_extracted(self, monkeypatch):
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "thread_id": "t-1",
                    "x-aimock-context": "showcase/d5",
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers["x-aimock-context"] == "showcase/d5"

    def test_raw_x_header_on_context_is_extracted(self, monkeypatch):
        self._patch_get_config(
            monkeypatch,
            {
                "context": {
                    "x-aimock-strict": "true",
                },
                "configurable": {},
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers["x-aimock-strict"] == "true"

    def test_non_x_keys_on_configurable_are_not_extracted(self, monkeypatch):
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "thread_id": "t-1",
                    "user_id": "u-42",
                    "checkpoint_ns": "",
                    "x-aimock-context": "test",
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert "thread_id" not in headers
        assert "user_id" not in headers
        assert "checkpoint_ns" not in headers
        assert headers == {"x-aimock-context": "test"}

    def test_wrapper_dict_still_works(self, monkeypatch):
        """Backward compat: the copilotkit_forwarded_headers wrapper dict
        is still the preferred source."""
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "copilotkit_forwarded_headers": {
                        "x-aimock-strict": "true",
                        "x-custom-trace": "abc",
                    },
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers["x-aimock-strict"] == "true"
        assert headers["x-custom-trace"] == "abc"

    def test_wrapper_dict_takes_precedence_over_raw_key(self, monkeypatch):
        """When both the wrapper dict and a raw key provide the same header,
        the wrapper-dict value wins."""
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "copilotkit_forwarded_headers": {
                        "x-aimock-context": "from-wrapper",
                    },
                    "x-aimock-context": "from-raw",
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers["x-aimock-context"] == "from-wrapper"

    def test_wrapper_dict_keys_lowercased_at_insertion(self, monkeypatch):
        """Wrapper-dict keys must be lowercased at insertion so that
        documented context > configurable precedence holds regardless of
        the casing the agent author used."""
        self._patch_get_config(
            monkeypatch,
            {
                "context": {
                    "copilotkit_forwarded_headers": {
                        "X-Trace": "from-context",
                    },
                },
                "configurable": {
                    "copilotkit_forwarded_headers": {
                        "x-trace": "from-configurable",
                    },
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        # Context wins via first-write-wins (both lowercase to "x-trace").
        assert headers["x-trace"] == "from-context"
        # Only the lowercased key exists — no mixed-case duplicate.
        assert "X-Trace" not in headers

    def test_multiple_raw_x_headers_extracted(self, monkeypatch):
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "x-aimock-context": "showcase/d5",
                    "x-aimock-strict": "true",
                    "x-request-id": "req-123",
                    "thread_id": "t-1",
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers == {
            "x-aimock-context": "showcase/d5",
            "x-aimock-strict": "true",
            "x-request-id": "req-123",
        }

    def test_no_headers_when_config_has_no_x_keys(self, monkeypatch):
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "thread_id": "t-1",
                    "user_id": "u-42",
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers == {}

    def test_runtime_error_clears_contextvar(self):
        """When get_config() raises RuntimeError (not inside a runnable),
        the function clears the ContextVar so stale headers from a prior
        request do not leak through."""
        set_forwarded_headers({"x-stale": "leftover"})
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers == {}

    def test_non_string_values_are_skipped(self, monkeypatch):
        """Only string values are extracted; lists/dicts/ints are ignored."""
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "x-valid": "yes",
                    "x-list-value": ["a", "b"],
                    "x-int-value": 42,
                    "x-dict-value": {"nested": True},
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers == {"x-valid": "yes"}

    def test_contextvar_cleared_when_no_headers(self, monkeypatch):
        """When the current call has no x-* headers, the ContextVar must be
        reset to an empty dict so stale headers from a previous call in the
        same async context do not leak through."""
        # Pre-populate the ContextVar with stale headers.
        set_forwarded_headers({"x-stale": "leftover"})
        assert get_forwarded_headers() == {"x-stale": "leftover"}

        # Config has no x-* keys at all.
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {
                    "thread_id": "t-1",
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers == {}

    def test_exception_safety_unexpected_config_shape(self, monkeypatch):
        """If the config has an unexpected shape that raises during
        extraction, the function must not propagate the exception — header
        forwarding is best-effort and must never block the LLM call.
        Additionally, stale headers from a prior request must be cleared."""

        class _ExplodingDict:
            """A dict-like that raises on .get() to simulate unexpected shapes."""

            def get(self, key, default=None):
                raise TypeError(f"boom on {key}")

        import langgraph.config as _lg_config

        monkeypatch.setattr(_lg_config, "get_config", lambda: _ExplodingDict())

        # Pre-populate stale headers.
        set_forwarded_headers({"x-stale": "leftover"})

        # Must not raise.
        _extract_forwarded_headers_from_config()

        # The ContextVar must be cleared so stale headers don't leak.
        headers = get_forwarded_headers()
        assert headers == {}

    def test_context_wins_over_configurable_in_wrapper_dict(self, monkeypatch):
        """When both config["context"] and config["configurable"] have
        copilotkit_forwarded_headers with the same key, the context value
        wins (LangGraph >=0.6.0 introduced context as the newer preferred
        mechanism)."""
        self._patch_get_config(
            monkeypatch,
            {
                "context": {
                    "copilotkit_forwarded_headers": {
                        "x-aimock-context": "from-context",
                    },
                },
                "configurable": {
                    "copilotkit_forwarded_headers": {
                        "x-aimock-context": "from-configurable",
                    },
                },
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers["x-aimock-context"] == "from-context"

    # -- F1: Integration test — wrap_model_call invokes header extraction ------

    def test_wrap_model_call_invokes_header_extraction(self, monkeypatch):
        """Removing the _extract_forwarded_headers_from_config() call from
        wrap_model_call would cause this test to fail, proving the call site
        is exercised end-to-end."""
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {"x-aimock-context": "via-wrap-model-call"},
            },
        )

        captured_headers: dict[str, str] = {}

        def handler(request):
            captured_headers.update(get_forwarded_headers())
            return "model-response"

        middleware = CopilotKitMiddleware()
        request = _make_request(state={"messages": []})
        middleware.wrap_model_call(request, handler)

        assert captured_headers.get("x-aimock-context") == "via-wrap-model-call"

    # -- F2: Integration test — awrap_model_call (async) invokes extraction ----

    def test_awrap_model_call_invokes_header_extraction(self, monkeypatch):
        """Same as the sync test above but exercising the async code path."""
        self._patch_get_config(
            monkeypatch,
            {
                "configurable": {"x-aimock-context": "via-awrap-model-call"},
            },
        )

        captured_headers: dict[str, str] = {}

        async def handler(request):
            captured_headers.update(get_forwarded_headers())
            return "model-response"

        middleware = CopilotKitMiddleware()
        request = _make_request(state={"messages": []})
        asyncio.run(middleware.awrap_model_call(request, handler))

        assert captured_headers.get("x-aimock-context") == "via-awrap-model-call"

    # -- F3: Wrapper dict on config["context"] only (LangGraph >=0.6.0) --------

    def test_wrapper_dict_on_context_only(self, monkeypatch):
        """The copilotkit_forwarded_headers wrapper dict on config['context']
        (not configurable) must also be extracted — this is the LangGraph
        >=0.6.0 path."""
        self._patch_get_config(
            monkeypatch,
            {
                "context": {
                    "copilotkit_forwarded_headers": {"x-aimock-strict": "true"},
                },
                "configurable": {},
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers.get("x-aimock-strict") == "true"

    # -- F6: None values for context / configurable (the `or {}` fallback) -----

    def test_none_context_falls_back_to_configurable(self, monkeypatch):
        """config['context'] = None must not crash; headers from configurable
        should still be extracted via the `or {}` fallback."""
        self._patch_get_config(
            monkeypatch,
            {
                "context": None,
                "configurable": {"x-aimock-context": "via-raw"},
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers.get("x-aimock-context") == "via-raw"

    def test_none_configurable_falls_back_to_context(self, monkeypatch):
        """config['configurable'] = None must not crash; headers from context
        should still be extracted via the `or {}` fallback."""
        self._patch_get_config(
            monkeypatch,
            {
                "context": {"x-aimock-context": "via-context"},
                "configurable": None,
            },
        )
        _extract_forwarded_headers_from_config()
        headers = get_forwarded_headers()
        assert headers.get("x-aimock-context") == "via-context"


# ---------------------------------------------------------------------------
# Auto-A2UI — middleware injects + executes generate_a2ui when the frontend
# registered a catalog (surfaced into state["ag-ui"]["a2ui_schema"])
# ---------------------------------------------------------------------------
#
# Contract: the developer passes nothing — using the middleware is enough.
# generate_a2ui is advertised to the model only when an A2UI catalog is
# present, is built from the agent's own (inferred) model, and is executed by
# the middleware itself (it is never in the agent's static tool registry).

from langgraph.prebuilt.tool_node import ToolCallRequest  # noqa: E402
from copilotkit.copilotkit_lg_middleware import (  # noqa: E402
    get_a2ui_tools,
    _a2ui_tools_by_thread,
)

_a2ui_unavailable = pytest.mark.skipif(
    get_a2ui_tools is None,
    reason=(
        "ag-ui-langgraph without get_a2ui_tools; the single-arg "
        "A2UIToolParams API needs the OSS-248 release (>=0.0.41)"
    ),
)


def _make_tool_request(name: str, *, tool: Any = None, state: dict | None = None):
    return ToolCallRequest(
        tool_call={"name": name, "id": "tc-1", "args": {}},
        tool=tool,
        state=state if state is not None else {"messages": []},
        runtime=MagicMock(name="runtime"),
    )


def _run_wrap_tool(middleware: CopilotKitMiddleware, request: ToolCallRequest):
    handler = _CapturingHandler()
    middleware.wrap_tool_call(request, handler)
    return handler.received


# A2UI is opt-in: injection requires the inject_a2ui_tool flag (forwarded by the
# A2UI middleware and surfaced into ag-ui state). The catalog/schema only binds
# generated surfaces; it is not the gate.
_A2UI_STATE = {
    "messages": [],
    "ag-ui": {"a2ui_schema": "<components/>", "inject_a2ui_tool": True},
}


@_a2ui_unavailable
class TestAutoA2UI:
    def setup_method(self) -> None:
        # Isolate the module-level bridge between tests (thread id is None in
        # unit tests, so all calls share _DEFAULT_THREAD_KEY).
        _a2ui_tools_by_thread.clear()

    def test_not_injected_without_flag(self):
        middleware = CopilotKitMiddleware()
        request = _make_request(state={"messages": []}, tools=[{"name": "backend"}])

        seen, _ = _run_wrap(middleware, request)

        assert [t["name"] for t in seen.tools] == ["backend"]

    def test_not_injected_when_flag_absent_even_with_catalog(self):
        """Opt-in: a catalog alone never triggers injection without the flag."""
        middleware = CopilotKitMiddleware()
        state = {"messages": [], "ag-ui": {"a2ui_schema": "<components/>"}}
        request = _make_request(state=state, tools=[{"name": "backend"}])

        seen, _ = _run_wrap(middleware, request)

        names = [getattr(t, "name", None) or t.get("name") for t in seen.tools]
        assert "generate_a2ui" not in names
        assert "backend" in names

    def test_injected_when_flag_present(self):
        middleware = CopilotKitMiddleware()
        request = _make_request(state=dict(_A2UI_STATE), tools=[{"name": "backend"}])

        seen, _ = _run_wrap(middleware, request)

        names = [getattr(t, "name", None) or t.get("name") for t in seen.tools]
        assert "backend" in names
        assert "generate_a2ui" in names

    # --- host a2ui_params override (the design-guidelines parity gap) ---------
    #
    # Before this, the auto-inject path hardwired get_a2ui_tools to the toolkit
    # defaults: a host serving via CopilotKitMiddleware() could NOT override the
    # design/generation guidelines (e.g. to favor a repeating-card layout). The
    # a2ui_params kwarg threads a host override through; the middleware still
    # injects the bound model and folds the registered catalog in (host wins).

    @staticmethod
    def _spy_get_a2ui_tools(monkeypatch) -> "list[dict]":
        """Patch get_a2ui_tools to capture the params dict it is called with and
        return a stub tool named generate_a2ui. Returns the capture list."""
        captured: "list[dict]" = []

        def _spy(params):
            captured.append(params)
            stub = MagicMock(name="generate_a2ui_tool")
            stub.name = "generate_a2ui"
            return stub

        monkeypatch.setattr("copilotkit.copilotkit_lg_middleware.get_a2ui_tools", _spy)
        return captured

    # Runtime-proxy path: a registered catalog arrives as a context entry, so
    # the middleware derives a component_schema + catalog_id to fold in.
    _A2UI_CONTEXT_STATE = {
        "messages": [],
        "ag-ui": {"inject_a2ui_tool": True},
        "copilotkit": {
            "context": [
                {
                    "description": "A2UI catalog capabilities",
                    "value": "Available A2UI catalog:\n- my-custom-catalog\n"
                    "  - Card: {...}",
                }
            ]
        },
    }

    def test_host_a2ui_params_guidelines_reach_subagent(self, monkeypatch):
        captured = self._spy_get_a2ui_tools(monkeypatch)
        middleware = CopilotKitMiddleware(
            a2ui_params={"guidelines": {"design_guidelines": "REPEAT_CARDS_MARK"}}
        )
        request = _make_request(state=dict(_A2UI_STATE), tools=[])

        _run_wrap(middleware, request)

        assert len(captured) == 1
        params = captured[0]
        # Host override survives...
        assert params["guidelines"]["design_guidelines"] == "REPEAT_CARDS_MARK"
        # ...the middleware still injects the bound model...
        assert params["model"] is request.model
        # ...and the native path contributes no composition_guide.
        assert "composition_guide" not in params["guidelines"]

    def test_host_override_merges_with_registered_catalog(self, monkeypatch):
        captured = self._spy_get_a2ui_tools(monkeypatch)
        middleware = CopilotKitMiddleware(
            a2ui_params={"guidelines": {"design_guidelines": "REPEAT_CARDS_MARK"}}
        )

        _run_wrap(
            middleware, _make_request(state=dict(self._A2UI_CONTEXT_STATE), tools=[])
        )

        params = captured[0]
        # Host guidance preserved alongside the catalog the middleware folded in.
        assert params["guidelines"]["design_guidelines"] == "REPEAT_CARDS_MARK"
        assert "my-custom-catalog" in params["guidelines"]["composition_guide"]
        assert params["default_catalog_id"] == "my-custom-catalog"

    def test_host_composition_guide_and_catalog_id_win(self, monkeypatch):
        captured = self._spy_get_a2ui_tools(monkeypatch)
        middleware = CopilotKitMiddleware(
            a2ui_params={
                "default_catalog_id": "host-catalog",
                "guidelines": {"composition_guide": "HOST_COMP"},
            }
        )

        _run_wrap(
            middleware, _make_request(state=dict(self._A2UI_CONTEXT_STATE), tools=[])
        )

        params = captured[0]
        # Host-set values are never clobbered by the registered catalog.
        assert params["guidelines"]["composition_guide"] == "HOST_COMP"
        assert params["default_catalog_id"] == "host-catalog"

    def test_default_no_params_carries_only_model(self, monkeypatch):
        captured = self._spy_get_a2ui_tools(monkeypatch)
        middleware = CopilotKitMiddleware()
        request = _make_request(state=dict(_A2UI_STATE), tools=[])

        _run_wrap(middleware, request)

        params = captured[0]
        # Prior behavior intact: just the inferred model, no host guidelines, no
        # catalog (native path with a non-JSON schema yields neither).
        assert params["model"] is request.model
        assert "guidelines" not in params
        assert "default_catalog_id" not in params

    def test_executed_via_wrap_tool_call_with_inferred_model(self):
        middleware = CopilotKitMiddleware()
        # Model call infers the model + stashes the built tool.
        _run_wrap(middleware, _make_request(state=dict(_A2UI_STATE), tools=[]))

        received = _run_wrap_tool(
            middleware, _make_tool_request("generate_a2ui", tool=None)
        )

        assert received.tool is not None
        assert received.tool.name == "generate_a2ui"

    def test_other_tool_call_passes_through_untouched(self):
        middleware = CopilotKitMiddleware()
        _run_wrap(middleware, _make_request(state=dict(_A2UI_STATE), tools=[]))

        backend_tool = MagicMock(name="backend")
        received = _run_wrap_tool(
            middleware, _make_tool_request("backend", tool=backend_tool)
        )

        assert received.tool is backend_tool

    def test_bridge_cleared_after_agent_stops_execution(self):
        middleware = CopilotKitMiddleware()
        _run_wrap(middleware, _make_request(state=dict(_A2UI_STATE), tools=[]))
        middleware.after_agent(dict(_A2UI_STATE), MagicMock(name="runtime"))

        received = _run_wrap_tool(
            middleware, _make_tool_request("generate_a2ui", tool=None)
        )

        assert received.tool is None

    # --- catalog sourced from wherever the frontend passed it ----------------

    def test_injected_from_copilotkit_context(self):
        """CopilotKit runtime-proxy path: catalog arrives as a context entry
        (the flag still gates injection)."""
        middleware = CopilotKitMiddleware()
        state = {
            "messages": [],
            "ag-ui": {"inject_a2ui_tool": True},
            "copilotkit": {
                "context": [
                    {
                        "description": "A2UI catalog capabilities: available "
                        "catalog IDs and custom component definitions.",
                        "value": "Available A2UI catalog:\n- my-custom-catalog\n"
                        "  - Card: {...}\n  - Metric: {...}",
                    }
                ]
            },
        }
        request = _make_request(state=state, tools=[{"name": "backend"}])

        seen, _ = _run_wrap(middleware, request)

        names = [getattr(t, "name", None) or t.get("name") for t in seen.tools]
        assert "generate_a2ui" in names
        assert "backend" in names

    def test_resolve_catalog_from_context_extracts_catalog_id(self):
        schema, catalog_id = CopilotKitMiddleware._resolve_a2ui_catalog(
            {
                "copilotkit": {
                    "context": [
                        {
                            "description": "A2UI catalog capabilities",
                            "value": "Available A2UI catalog:\n- declarative-gen-ui-catalog\n  ...",
                        }
                    ]
                }
            }
        )
        assert catalog_id == "declarative-gen-ui-catalog"
        assert schema and "declarative-gen-ui-catalog" in schema

    def test_resolve_catalog_from_native_schema_extracts_catalog_id(self):
        schema, catalog_id = CopilotKitMiddleware._resolve_a2ui_catalog(
            {
                "ag-ui": {
                    "a2ui_schema": json.dumps({"catalogId": "cat-x", "components": []})
                }
            }
        )
        # Native path: toolkit reads a2ui_schema from state, so no guide needed.
        assert schema is None
        assert catalog_id == "cat-x"

    def test_resolve_catalog_none_when_absent(self):
        assert CopilotKitMiddleware._resolve_a2ui_catalog({"messages": []}) is None

    # --- A2UI injectA2UITool flag (forwarded → ag-ui state) ------------------

    def test_inject_decision_reads_ag_ui_flag(self):
        read = CopilotKitMiddleware._a2ui_inject_decision
        assert read({"ag-ui": {"inject_a2ui_tool": True}}) is True
        assert read({"ag-ui": {"inject_a2ui_tool": "render_x"}}) == "render_x"
        assert read({"ag-ui": {"inject_a2ui_tool": False}}) is False
        # No flag at all → None (opt-in: no injection).
        assert read({"ag-ui": {}}) is None
        assert read({"messages": []}) is None

    def test_render_tool_dropped_when_ours_injected(self):
        """When we inject generate_a2ui, the runtime's render_a2ui (forwarded as
        a frontend action) is not advertised — the model sees one A2UI tool."""
        middleware = CopilotKitMiddleware()
        state = {
            **_A2UI_STATE,
            "copilotkit": {
                "actions": [{"name": "render_a2ui"}, {"name": "fe_tool"}],
            },
        }
        request = _make_request(state=state, tools=[])

        seen, _ = _run_wrap(middleware, request)

        names = [getattr(t, "name", None) or t.get("name") for t in seen.tools]
        assert "generate_a2ui" in names
        assert "fe_tool" in names
        assert "render_a2ui" not in names

    def test_not_injected_when_agent_already_defines_tool(self):
        """Agent already exposes generate_a2ui → don't double-inject."""
        middleware = CopilotKitMiddleware()
        existing = MagicMock()
        existing.name = "generate_a2ui"
        request = _make_request(state=dict(_A2UI_STATE), tools=[existing])

        seen, _ = _run_wrap(middleware, request)

        names = [getattr(t, "name", None) or t.get("name") for t in seen.tools]
        # Only the agent's own tool — no second generate_a2ui appended.
        assert names.count("generate_a2ui") == 1
