import asyncio
import json
from types import SimpleNamespace

import pytest
import research_desk.agent as agent_module
from ag_ui.core import (
    Context,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateDeltaEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    Tool,
)
from ag_ui_adk import CONTEXT_STATE_KEY, ADKAgent
from research_desk.agent import (
    DEFAULT_MODEL,
    _is_title_run,
    _without_internal_state,
    create_agent,
    instruction,
    use_selected_model,
)


def run_input(messages, forwarded_props=None):
    return RunAgentInput.model_validate(
        {
            "threadId": "t",
            "runId": "r",
            "state": {},
            "messages": messages,
            "tools": [],
            "context": [],
            "forwardedProps": forwarded_props or {},
        }
    )


def test_the_thread_naming_run_is_told_apart_from_a_question():
    naming = run_input(
        [
            {"id": "s", "role": "system", "content": "Name this thread. Return JSON"},
            {"id": "u", "role": "user", "content": "user: how warm is it"},
        ]
    )
    question = run_input(
        [{"id": "u", "role": "user", "content": "how warm is it"}],
        {"model": DEFAULT_MODEL},
    )
    assert _is_title_run(naming)
    assert not _is_title_run(question)


def test_internal_state_keys_never_reach_the_client():
    snapshot = StateSnapshotEvent(
        snapshot={"icon": "leaf", "_ag_ui_context": [{"value": "x"}]}
    )
    assert _without_internal_state(snapshot).snapshot == {"icon": "leaf"}

    delta = StateDeltaEvent.model_validate(
        {
            "type": "STATE_DELTA",
            "delta": [
                {"op": "add", "path": "/icon", "value": "leaf"},
                {"op": "add", "path": "/_ag_ui_context", "value": []},
            ],
        }
    )
    assert [op.path for op in _without_internal_state(delta).delta] == ["/icon"]


def test_selected_model_applies_only_when_known():
    request = SimpleNamespace(model=None)
    use_selected_model(
        SimpleNamespace(state={"model": "gemini-3.1-pro-preview"}), request
    )
    assert request.model == "gemini-3.1-pro-preview"

    use_selected_model(SimpleNamespace(state={"model": "not-a-model"}), request)
    assert request.model == DEFAULT_MODEL


def research_input(ui_format=None):
    value = run_input([], {"model": "gemini-3.1-pro-preview"})
    value.state = {"icon": "leaf", "_ui_format": "express"}
    if ui_format is not None:
        value.forwarded_props["uiFormat"] = ui_format
    value.forwarded_props["copilotkit"] = {
        "ui": {
            "v1.0": {
                "supportedCatalogIds": ["demo"],
                "inlineCatalogs": [
                    {
                        "catalogId": "demo",
                        "protocolVersion": "1.0",
                        "components": {
                            "Text": {
                                "props": {
                                    "type": "object",
                                    "properties": {"text": {"type": "string"}},
                                    "required": ["text"],
                                }
                            }
                        },
                        "functions": {},
                    }
                ],
            }
        }
    }
    value.context = [
        Context(description="User preferences", value="Be brief."),
        Context(description="Generative UI guide: JSON", value="Original JSON guide"),
    ]
    value.tools = [Tool(name="lookup", description="A frontend tool", parameters={})]
    return value


def stub_adk(monkeypatch, reply, captured, *, text_end=True):
    async def run(self, input):
        captured["input"] = input
        try:
            yield RunStartedEvent(thread_id=input.thread_id, run_id=input.run_id)
            yield StateSnapshotEvent(snapshot=input.state)
            for chunk in reply:
                yield TextMessageContentEvent(message_id="answer", delta=chunk)
            if text_end:
                yield TextMessageEndEvent(message_id="answer")
            yield RunFinishedEvent(thread_id=input.thread_id, run_id=input.run_id)
        finally:
            captured["closed"] = True

    monkeypatch.setattr(ADKAgent, "run", run)


def output_text(events):
    return "".join(
        event.delta for event in events if isinstance(event, TextMessageContentEvent)
    )


@pytest.mark.parametrize("ui_format", [None, "json", "unknown", "Express"])
async def test_json_is_default_and_preserves_fence_repair(monkeypatch, ui_format):
    captured = {}
    source = '```a2ui\n{"version":"v1.0","createSurface":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"hi"}]}\n```\n'
    stub_adk(monkeypatch, [source], captured)
    input = research_input(ui_format)
    events = [event async for event in create_agent().run(input)]

    operation = json.loads(output_text(events).split("```a2ui\n")[1].split("\n")[0])
    assert operation["createSurface"]["surfaceId"] == "s"
    assert captured["input"].context == input.context
    assert captured["input"].state["_ui_format"] == "json"
    assert captured["input"].state["model"] == "gemini-3.1-pro-preview"
    assert captured["input"].tools == input.tools
    assert events[-1].type == "RUN_FINISHED"
    assert captured["closed"]


async def test_express_compiles_without_json_repair_and_preserves_run_inputs(
    monkeypatch,
):
    captured = {}
    stub_adk(
        monkeypatch,
        ['Before.\n```a2ui-express\nsurface("s")\nroot = Text("Hello")\n```\nAfter.'],
        captured,
    )

    def no_json_repair():
        pytest.fail("Express must bypass the JSON fence repairer")

    monkeypatch.setattr(agent_module, "FenceRepairer", no_json_repair)
    input = research_input("express")
    events = [event async for event in create_agent().run(input)]
    text = output_text(events)
    assert text.startswith("Before.") and text.endswith("After.")
    assert '"createSurface"' in text and '"Hello"' in text
    assert "a2ui-express" not in text and "root =" not in text
    prepared = captured["input"]
    assert prepared.state == {
        "icon": "leaf",
        "_ui_format": "express",
        "model": "gemini-3.1-pro-preview",
    }
    assert prepared.tools == input.tools
    assert prepared.context[0] == input.context[0]
    assert "Original JSON guide" not in str(prepared.context)
    assert "Generative UI Express guide" in str(prepared.context)
    snapshot = next(
        event.snapshot for event in events if event.type == "STATE_SNAPSHOT"
    )
    assert snapshot == {"icon": "leaf", "model": "gemini-3.1-pro-preview"}
    assert events[-1].type == "RUN_FINISHED"
    assert captured["closed"]


async def test_express_preparation_error_starts_and_fails_without_running_adk(
    monkeypatch,
):
    captured = {}
    stub_adk(monkeypatch, [], captured)
    input = research_input("express")
    del input.forwarded_props["copilotkit"]
    events = [event async for event in create_agent().run(input)]
    assert [event.type for event in events] == ["RUN_STARTED", "RUN_ERROR"]
    assert events[-1].code == "EXPRESS_PREPARATION_ERROR"
    assert "input" not in captured


@pytest.mark.parametrize("text_end", [True, False])
async def test_invalid_final_express_retains_preview_and_never_finishes(
    monkeypatch, text_end
):
    captured = {}
    stub_adk(
        monkeypatch,
        [
            '```a2ui-express\nsurface("s")\nroot = Text("Valid preview")\n',
            "bad = MissingComponent()\n",
        ],
        captured,
        text_end=text_end,
    )
    events = [event async for event in create_agent().run(research_input("express"))]
    assert "Valid preview" in output_text(events)
    assert events[-1].type == "RUN_ERROR"
    assert events[-1].code == "EXPRESS_COMPILATION_ERROR"
    assert not any(event.type == "RUN_FINISHED" for event in events)
    assert captured["closed"]


async def test_title_run_bypasses_express_preparation(monkeypatch):
    input = run_input(
        [{"id": "s", "role": "system", "content": "Name this thread"}],
        {"uiFormat": "express"},
    )
    captured = {}
    stub_adk(monkeypatch, [], captured)

    async def title_run(value):
        assert value is input
        yield TextMessageContentEvent(message_id="title", delta='{"title":"Research"}')

    monkeypatch.setattr(agent_module, "_title_run", title_run)
    events = [event async for event in create_agent().run(input)]
    assert output_text(events) == '{"title":"Research"}'
    assert "input" not in captured


@pytest.mark.parametrize("ui_format", ["json", "express"])
async def test_icon_is_emitted_before_run_finishes(monkeypatch, ui_format):
    captured = {}
    stub_adk(monkeypatch, ["Answer"], captured)

    async def pick_icon(question):
        assert question == "A question"
        return "globe"

    monkeypatch.setattr(agent_module, "_pick_icon", pick_icon)
    input = research_input(ui_format)
    input.state = {}
    input.messages = run_input(
        [{"id": "u", "role": "user", "content": "A question"}]
    ).messages
    events = [event async for event in create_agent().run(input)]
    assert events[-2].type == "STATE_DELTA"
    assert events[-2].delta[0].value == "globe"
    assert events[-1].type == "RUN_FINISHED"


@pytest.mark.parametrize("ui_format", ["json", "express"])
async def test_disconnect_closes_adk_and_cancels_icon(monkeypatch, ui_format):
    captured = {}
    stub_adk(monkeypatch, [], captured)
    icon_started = asyncio.Event()
    icon_cancelled = asyncio.Event()

    async def pick_icon(question):
        try:
            icon_started.set()
            await asyncio.Future()
        finally:
            icon_cancelled.set()

    monkeypatch.setattr(agent_module, "_pick_icon", pick_icon)
    input = research_input(ui_format)
    input.state = {}
    input.messages = run_input(
        [{"id": "u", "role": "user", "content": "A question"}]
    ).messages
    stream = create_agent().run(input)
    assert (await anext(stream)).type == "RUN_STARTED"
    await asyncio.wait_for(icon_started.wait(), timeout=1)
    await stream.aclose()
    await asyncio.wait_for(icon_cancelled.wait(), timeout=1)
    assert captured["closed"]


@pytest.mark.parametrize("ui_format", ["json", "express"])
async def test_provider_error_remains_terminal_when_icon_is_ready(
    monkeypatch, ui_format
):
    async def run(self, input):
        yield RunStartedEvent(thread_id=input.thread_id, run_id=input.run_id)
        await asyncio.sleep(0)
        yield RunErrorEvent(message="Provider failed", code="PROVIDER_ERROR")

    async def pick_icon(question):
        return "globe"

    monkeypatch.setattr(ADKAgent, "run", run)
    monkeypatch.setattr(agent_module, "_pick_icon", pick_icon)
    input = research_input(ui_format)
    input.state = {}
    input.messages = run_input(
        [{"id": "u", "role": "user", "content": "A question"}]
    ).messages
    events = [event async for event in create_agent().run(input)]
    assert [event.type for event in events] == ["RUN_STARTED", "RUN_ERROR"]
    assert events[-1].code == "PROVIDER_ERROR"


def test_format_prompts_keep_research_rules_and_use_the_selected_syntax():
    json_prompt = instruction(SimpleNamespace(state={}))
    express_prompt = instruction(
        SimpleNamespace(
            state={
                "_ui_format": "express",
                CONTEXT_STATE_KEY: [{"description": "Guide", "value": "Catalog"}],
            }
        )
    )
    for shared_rule in (
        "call web_research first",
        "A view is optional",
        "one or two sentences of prose",
        "call find_images in the same turn as your research",
        "write it into the report sheet",
        "One answer, one view",
    ):
        assert shared_rule in json_prompt and shared_rule in express_prompt
    assert '"component":"Text"' in json_prompt
    assert "updateComponents line" in json_prompt
    assert "updateComponents line" not in express_prompt
    assert "```a2ui-express" in express_prompt
    assert 'Text(text={"@call"' in express_prompt
    assert "functionCall:saveNote(" in express_prompt
    assert "userMessage:" in express_prompt and "context:" in express_prompt
    assert 'radius="md"' in express_prompt
    assert express_prompt.endswith("App Context:\nGuide:\nCatalog")
