"""Exercise sales App Context through the declarative UI route and planner."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import ClassVar

import httpx
import pytest
from ag_ui.core import Context
from pydantic_ai import RunContext
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

USER_TURN = "Show me Q3 sales by region as a pie chart"
DATASET = "Revenue: $4.2M"
COMPOSITION = "Sort sales representatives by attainment."


@pytest.fixture
def dynamic_agent(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-a2ui")
    from agents import a2ui_dynamic

    return a2ui_dynamic


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

    captured_messages: ClassVar[list[dict]] = []

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
                "catalogId": "wrong-catalog",
                "components": [{"id": "root", "component": "Card"}],
                "data": {},
            }
        )
        return _FakeResponse([_FakeChoice(_FakeMessage([_FakeToolCall(valid_args)]))])


def _build_ctx(dynamic_agent) -> RunContext:
    return RunContext(
        deps=dynamic_agent.SalesAnalystDeps(
            state=dynamic_agent.EmptyState(),
            app_context=(Context(description="Sales fixture", value=DATASET),),
        ),
        model=TestModel(),
        usage=RunUsage(),
        messages=[
            ModelRequest(parts=[UserPromptPart(content=USER_TURN)]),
            ModelResponse(parts=[TextPart(content="On it — drawing your dashboard.")]),
        ],
    )


def test_sales_context_reaches_both_models(monkeypatch, dynamic_agent):
    from agent_server import app

    model_instructions = []

    async def primary_model(_messages, info):
        model_instructions.append(info.instructions)
        if len(model_instructions) == 1:
            yield {0: DeltaToolCall(name="generate_a2ui", json_args="{}")}
        else:
            yield "Dashboard ready."

    async def post():
        transport = httpx.ASGITransport(app=app)
        with dynamic_agent.agent.override(
            model=FunctionModel(stream_function=primary_model)
        ):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                return await client.post(
                    "/a2ui_dynamic/",
                    json={
                        "threadId": "sales-thread",
                        "runId": "sales-run",
                        "state": {},
                        "messages": [
                            {"id": "user", "role": "user", "content": USER_TURN}
                        ],
                        "context": [
                            {"description": "Sales dataset", "value": DATASET},
                            {"description": "Composition rules", "value": COMPOSITION},
                        ],
                        "tools": [],
                        "forwardedProps": {},
                    },
                )

    monkeypatch.setattr("openai.OpenAI", _CapturingOpenAI)
    _CapturingOpenAI.captured_messages = []
    response = asyncio.run(post())
    assert response.status_code == 200
    assert len(model_instructions) == 2
    primary_prompt = model_instructions[0] or ""
    planner = _CapturingOpenAI.captured_messages
    assert planner[0]["role"] == "system"
    assert planner[1] == {"role": "user", "content": USER_TURN}
    for marker in (DATASET, COMPOSITION):
        assert marker in primary_prompt
        assert marker in planner[0]["content"]
    assert "DataTable" in planner[0]["content"]

    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[-1]["type"] == "RUN_FINISHED"
    (result,) = (event for event in events if event["type"] == "TOOL_CALL_RESULT")
    operations = json.loads(result["content"])["a2ui_operations"]
    assert operations[0]["createSurface"]["catalogId"] == "declarative-gen-ui-catalog"


def test_part_content_with_none_text_does_not_crash(dynamic_agent):
    """A multimodal content part whose `.text` is None must not raise.

    Regression: `_part_content_to_text` unconditionally appended `part.text`,
    so a part with `text=None` (or a non-str) caused `"".join(...)` to raise
    TypeError. The guard now skips non-str text values.
    """

    class _PartWithNoneText:
        text = None

    class _PartWithRealText:
        text = "hello"

    out = dynamic_agent._part_content_to_text(
        [_PartWithNoneText(), "world", _PartWithRealText()]
    )
    # None is skipped; str parts are concatenated.
    assert out == "worldhello", out


def test_malformed_tool_call_arguments_returns_structured_error(
    monkeypatch, dynamic_agent
):
    """Malformed JSON from the secondary render_a2ui call yields a structured
    error string, not an exception escaping the tool."""
    import openai

    class _BadArgsOpenAI(_CapturingOpenAI):
        def create(self, *, model, messages, tools, tool_choice, **kwargs):
            return _FakeResponse(
                [_FakeChoice(_FakeMessage([_FakeToolCall("{not valid json")]))]
            )

    monkeypatch.setattr(openai, "OpenAI", _BadArgsOpenAI)

    result = dynamic_agent.generate_a2ui(_build_ctx(dynamic_agent))
    parsed = json.loads(result)
    assert "error" in parsed, parsed
    assert "a2ui_operations" not in parsed, parsed


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
