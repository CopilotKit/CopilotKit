"""Red-green proof for the pydantic-ai declarative-gen-ui (a2ui_dynamic) fix.

Defect: `generate_a2ui` read the conversation from
`getattr(ctx.deps, "copilotkit", None)`, but `StateDeps` has only a
`state` field, so that attribute is ALWAYS None. The secondary gen-ui LLM
call therefore received a system-only / empty-context prompt and produced
the wrong a2ui shape.

Fix: read the REAL forwarded conversation from `ctx.messages` (the
pydantic-ai RunContext message history) and build the secondary prompt as
`[system, *real_messages]` — the langgraph-python north-star shape.

This test invokes the real `generate_a2ui` tool with a representative
RunContext carrying a real user turn, intercepts the secondary OpenAI
call, and asserts the secondary LLM actually receives that user turn.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make `src/` and `tools/` importable the same way the app entrypoint does.
_INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_INTEGRATION_ROOT / "src"))
sys.path.insert(0, str(_INTEGRATION_ROOT))

from pydantic import BaseModel  # noqa: E402
from pydantic_ai import RunContext  # noqa: E402
from pydantic_ai.ag_ui import StateDeps  # noqa: E402
from pydantic_ai.messages import (  # noqa: E402
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.test import TestModel  # noqa: E402
from pydantic_ai.usage import RunUsage  # noqa: E402

from agents import a2ui_dynamic  # noqa: E402


USER_TURN = "Show me Q3 sales by region as a pie chart"


class _FakeMessage:
    def __init__(self, tool_calls):
        self.tool_calls = tool_calls


class _FakeToolCall:
    def __init__(self, arguments: str):
        self.function = type("F", (), {"name": "render_a2ui", "arguments": arguments})()


class _FakeChoice:
    def __init__(self, message):
        self.message = message


class _FakeResponse:
    def __init__(self, choices):
        self.choices = choices


class _CapturingOpenAI:
    """Stand-in for openai.OpenAI that records the secondary-call messages."""

    captured_messages: list = []

    def __init__(self, *args, **kwargs):
        pass

    @property
    def chat(self):
        return self

    @property
    def completions(self):
        return self

    def create(self, *, model, messages, tools, tool_choice, **kwargs):
        type(self).captured_messages = messages
        valid_args = json.dumps(
            {
                "surfaceId": "declarative-surface",
                "catalogId": a2ui_dynamic.CUSTOM_CATALOG_ID,
                "components": [{"id": "root", "component": "Card"}],
                "data": {},
            }
        )
        return _FakeResponse([_FakeChoice(_FakeMessage([_FakeToolCall(valid_args)]))])


def _build_ctx() -> RunContext:
    class _State(BaseModel):
        pass

    return RunContext(
        deps=StateDeps[_State](state=_State()),
        model=TestModel(),
        usage=RunUsage(),
        messages=[
            ModelRequest(parts=[UserPromptPart(content=USER_TURN)]),
            ModelResponse(parts=[TextPart(content="On it — drawing your dashboard.")]),
        ],
    )


def _call_tool(ctx: RunContext) -> str:
    # `@agent.tool` wraps the function; the original is on `.function`.
    fn = getattr(a2ui_dynamic.generate_a2ui, "function", a2ui_dynamic.generate_a2ui)
    return fn(ctx)


def test_secondary_call_includes_real_conversation(monkeypatch):
    import openai

    monkeypatch.setattr(openai, "OpenAI", _CapturingOpenAI)
    _CapturingOpenAI.captured_messages = []

    result = _call_tool(_build_ctx())

    sent = _CapturingOpenAI.captured_messages
    user_msgs = [m for m in sent if m.get("role") == "user"]

    # BEFORE the fix this list is EMPTY (copilotkit attr is always None) ->
    # the secondary call is system-only and this assertion fails.
    assert user_msgs, (
        "secondary gen-ui call received NO real user message "
        f"(system-only prompt). messages sent: {sent}"
    )
    assert any(USER_TURN in (m.get("content") or "") for m in user_msgs), (
        f"real user turn not forwarded to secondary call. user msgs: {user_msgs}"
    )

    # And it still produces a valid a2ui_operations container.
    parsed = json.loads(result)
    assert "a2ui_operations" in parsed, parsed


def test_part_content_with_none_text_does_not_crash():
    """A multimodal content part whose `.text` is None must not raise.

    Regression: `_part_content_to_text` unconditionally appended `part.text`,
    so a part with `text=None` (or a non-str) caused `"".join(...)` to raise
    TypeError. The guard now skips non-str text values.
    """

    class _PartWithNoneText:
        text = None

    class _PartWithRealText:
        text = "hello"

    out = a2ui_dynamic._part_content_to_text(
        [_PartWithNoneText(), "world", _PartWithRealText()]
    )
    # None is skipped; str parts are concatenated.
    assert out == "worldhello", out


def test_malformed_tool_call_arguments_returns_structured_error(monkeypatch):
    """Malformed JSON from the secondary render_a2ui call yields a structured
    error string, not an exception escaping the tool."""
    import openai

    class _BadArgsOpenAI(_CapturingOpenAI):
        def create(self, *, model, messages, tools, tool_choice, **kwargs):
            return _FakeResponse(
                [_FakeChoice(_FakeMessage([_FakeToolCall("{not valid json")]))]
            )

    monkeypatch.setattr(openai, "OpenAI", _BadArgsOpenAI)

    result = _call_tool(_build_ctx())
    parsed = json.loads(result)
    assert "error" in parsed, parsed
    assert "a2ui_operations" not in parsed, parsed


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
