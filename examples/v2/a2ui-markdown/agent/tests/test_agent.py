"""The ADK demo must preserve frontend context, tools, and configuration boundaries."""

import asyncio
import importlib
import itertools
import json
import re
import sys
from types import SimpleNamespace

import httpx
import pytest
from ag_ui.core import (
    AssistantMessage,
    Context,
    EventType,
    FunctionCall,
    RunAgentInput,
    RunFinishedEvent,
    Tool,
    ToolCall,
    ToolMessage,
    UserMessage,
)
from ag_ui_adk import CONTEXT_STATE_KEY, ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from fastapi import FastAPI
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field

from src.agent import FORMATS, MODELS, SYSTEM_PROMPT, TRANSPORTS, create_agent


@pytest.fixture
async def managed_agent():
    """Close adapter services before pytest tears down each test's event loop."""
    agents = []

    def create(*config):
        agent = create_agent(*config)
        agents.append(agent)
        return agent

    try:
        yield create
    finally:
        for agent in agents:
            await agent.close()


def run_input():
    return RunAgentInput(
        thread_id="same-thread",
        run_id="test-run",
        messages=[UserMessage(id="user-1", content="Show a helpful card")],
        context=[
            Context(description="Frontend schema", value='{"Text": {"text": "string"}}')
        ],
        tools=[
            Tool(
                name="render_ui",
                description="Render frontend UI",
                parameters={
                    "type": "object",
                    "properties": {"surface": {"type": "string"}},
                },
            )
        ],
        state={},
        forwarded_props={},
    )


def test_factory_creates_isolated_api_key_only_configurations(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    agents = [
        create_agent(*config)
        for config in itertools.product(MODELS, FORMATS, TRANSPORTS)
    ]

    assert len(agents) == 8
    assert len({agent._static_app_name for agent in agents}) == 8
    assert len({id(agent._session_manager) for agent in agents}) == 8
    for agent, (model, _, _) in zip(
        agents, itertools.product(MODELS, FORMATS, TRANSPORTS)
    ):
        assert agent._adk_agent.model.model == model
        assert agent._adk_agent.model.client_kwargs["vertexai"] is False
        assert agent._streaming_function_call_arguments is False
        assert len(agent._adk_agent.tools) == 1
        assert isinstance(agent._adk_agent.tools[0], AGUIToolset)
        assert agent._adk_agent.instruction(SimpleNamespace(state={})) == SYSTEM_PROMPT


@pytest.mark.parametrize(
    "config",
    [
        ("other", "json", "tool"),
        (MODELS[0], "xml", "tool"),
        (MODELS[0], "json", "other"),
    ],
)
def test_factory_rejects_unsupported_configurations(config):
    with pytest.raises(ValueError):
        create_agent(*config)


def test_instruction_uses_current_frontend_context_without_format_specific_prompt():
    agent = create_agent(MODELS[0], "json", "markdown")
    instruction = agent._adk_agent.instruction
    state = {CONTEXT_STATE_KEY: [entry.model_dump() for entry in run_input().context]}
    prompt = instruction(SimpleNamespace(state=state))
    assert SYSTEM_PROMPT in prompt
    assert "App Context" in prompt
    assert "Frontend schema" in prompt
    assert run_input().context[0].value in prompt
    assert "```" not in SYSTEM_PROMPT
    assert "express" not in SYSTEM_PROMPT.lower()
    state[CONTEXT_STATE_KEY] = [
        {"description": "Updated context", "value": "New schema"}
    ]
    updated = instruction(SimpleNamespace(state=state))
    assert "New schema" in updated
    assert "Frontend schema" not in updated


@pytest.mark.parametrize("transport", TRANSPORTS)
async def test_json_passes_input_and_events_through_unchanged(monkeypatch, transport):
    incoming = run_input()
    outgoing = RunFinishedEvent(thread_id=incoming.thread_id, run_id=incoming.run_id)
    received = []

    async def fake_run(self, input):
        received.append(input)
        yield outgoing

    monkeypatch.setattr(ADKAgent, "run", fake_run)
    agent = create_agent(MODELS[0], "json", transport)
    events = [event async for event in agent.run(incoming)]
    assert received == [incoming]
    assert received[0] is incoming
    assert events[0] is outgoing


@pytest.mark.parametrize("transport", TRANSPORTS)
async def test_express_prepares_input_and_transforms_output(monkeypatch, transport):
    incoming = run_input()
    prepared = incoming.model_copy(update={"context": []})
    compiler = object()
    raw = RunFinishedEvent(thread_id=incoming.thread_id, run_id=incoming.run_id)
    transformed = RunFinishedEvent(thread_id="compiled-thread", run_id=incoming.run_id)
    calls = []

    def prepare(input, selected_transport):
        calls.append(("prepare", input, selected_transport))
        return prepared, compiler

    async def fake_run(self, input):
        assert input is prepared
        yield raw

    async def transform(events, supplied_compiler, selected_transport):
        assert supplied_compiler is compiler
        assert selected_transport == transport
        assert [event async for event in events] == [raw]
        yield transformed

    monkeypatch.setitem(
        sys.modules,
        "src.transport",
        SimpleNamespace(
            prepare_express_input=prepare, transform_express_events=transform
        ),
    )
    monkeypatch.setattr(ADKAgent, "run", fake_run)
    agent = create_agent(MODELS[0], "express", transport)
    events = [event async for event in agent.run(incoming)]
    assert calls == [("prepare", incoming, transport)]
    assert events == [transformed]


async def test_express_preparation_error_emits_a_terminal_ag_ui_error(monkeypatch):
    def prepare(*args):
        raise ValueError("Invalid frontend schema")

    monkeypatch.setitem(
        sys.modules,
        "src.transport",
        SimpleNamespace(prepare_express_input=prepare, transform_express_events=None),
    )
    incoming = run_input()
    agent = create_agent(MODELS[0], "express", "tool")
    events = [event async for event in agent.run(incoming)]
    assert [event.type for event in events] == [
        EventType.RUN_STARTED,
        EventType.RUN_ERROR,
    ]
    assert events[0].thread_id == incoming.thread_id
    assert events[0].run_id == incoming.run_id
    assert "Invalid frontend schema" in events[-1].message


class RecordingLlm(BaseLlm):
    """Exercise the real ADK request pipeline without credentials or network calls."""

    model: str = "test-llm"
    requests: list = Field(default_factory=list)

    async def generate_content_async(self, llm_request, stream=False):
        self.requests.append(llm_request)
        yield LlmResponse(
            content=types.Content(
                role="model", parts=[types.Part(text="A helpful answer")]
            )
        )


async def test_frontend_context_and_tools_reach_the_adk_model(managed_agent):
    agent = managed_agent(MODELS[0], "json", "tool")
    model = RecordingLlm()
    agent._adk_agent.model = model
    incoming = run_input()
    events = [event async for event in agent.run(incoming)]
    assert not [event for event in events if event.type == EventType.RUN_ERROR]
    assert events[0].type == EventType.RUN_STARTED
    assert events[-1].type == EventType.RUN_FINISHED
    assert model.requests
    request = model.requests[0]
    assert incoming.context[0].value in str(request.config.system_instruction)
    assert "render_ui" in request.tools_dict
    assert "Show a helpful card" in str(request.contents)


async def test_server_registers_eight_namespaced_adapter_routes(monkeypatch):
    app = importlib.import_module("main").app
    schema = app.openapi()
    assert len(schema["paths"]) == 24
    operation_ids = [
        operation["operationId"]
        for path in schema["paths"].values()
        for operation in path.values()
    ]
    assert len(operation_ids) == len(set(operation_ids))

    async def fake_run(self, input):
        yield RunFinishedEvent(thread_id=input.thread_id, run_id=input.run_id)

    monkeypatch.setattr("src.agent.DemoAgent.run", fake_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for model, format, transport in itertools.product(MODELS, FORMATS, TRANSPORTS):
            prefix = f"/copilotkit/{model}/{format}/{transport}"
            assert "post" in schema["paths"][prefix]
            assert "post" in schema["paths"][f"{prefix}/agents/state"]
            assert "get" in schema["paths"][f"{prefix}/capabilities"]
            response = await client.post(
                prefix, json=run_input().model_dump(by_alias=True)
            )
            assert response.status_code == 200
            assert "RUN_FINISHED" in response.text


async def test_closing_json_run_closes_underlying_adapter_stream(monkeypatch):
    closed = []

    async def fake_run(self, input):
        try:
            yield RunFinishedEvent(thread_id=input.thread_id, run_id=input.run_id)
        finally:
            closed.append(True)

    monkeypatch.setattr(ADKAgent, "run", fake_run)
    stream = create_agent(MODELS[0], "json", "tool").run(run_input())
    await anext(stream)
    await stream.aclose()
    assert closed == [True]


def ui_input(transport):
    """A small frontend-owned catalog, with the same envelope used by the runtime."""
    incoming = run_input()
    incoming.forwarded_props = {
        "copilotkit": {
            "ui": {
                "v1.0": {
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
                    ]
                },
                "metadata": {
                    "extensions": {
                        "copilotkit_targets": [{"id": "chat", "kind": "chat"}],
                        "copilotkit_surfaces": [],
                    }
                },
            }
        }
    }
    incoming.context.append(
        Context(
            description="Generative UI guide: JSON rendering contract.",
            value="Use the frontend Text component and render v1.0 UI operations.",
        )
    )
    incoming.tools = (
        []
        if transport == "markdown"
        else [
            Tool(
                name="render_ui",
                description="Render UI",
                parameters={
                    "type": "object",
                    "properties": {
                        "target": {"type": "string"},
                        "operations": {"type": "array", "items": {"type": "object"}},
                    },
                    "required": ["target", "operations"],
                },
            )
        ]
    )
    return incoming


def expected_ui():
    return [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "answer",
                "catalogId": "demo",
                "components": [{"id": "root", "component": "Text", "text": "Hello"}],
            },
        }
    ]


class UiLlm(BaseLlm):
    """Deterministic Gemini-shaped responses; never contacts a model service."""

    model: str = "test-llm"
    format: str
    transport: str
    invalid_source: bool = False
    requests: list = Field(default_factory=list)

    async def generate_content_async(self, llm_request, stream=False):
        self.requests.append(llm_request)
        if len(self.requests) > 1:
            text = "Updated after UI action"
        else:
            source = 'surface("answer")\nroot = Text("Hello")'
            if self.invalid_source:
                source = 'root = MissingComponent("Hello")'
            if self.transport == "tool":
                args = {"target": "chat"}
                args.update(
                    {"source": source}
                    if self.format == "express"
                    else {"operations": expected_ui()}
                )
                yield LlmResponse(
                    content=types.Content(
                        role="model",
                        parts=[
                            types.Part(
                                function_call=types.FunctionCall(
                                    id="model-render-ui",
                                    name="render_ui",
                                    args=args,
                                )
                            ),
                        ],
                    )
                )
                return
            language = "a2ui-express" if self.format == "express" else "a2ui"
            body = source if self.format == "express" else json.dumps(expected_ui())
            text = f"Here is a card.\n```{language} target=chat\n{body}\n```\nEnjoy."

        # Stream token-sized chunks, including splits in the opening/closing fence.
        for start in range(0, len(text), 7):
            yield LlmResponse(
                partial=True,
                content=types.Content(
                    role="model",
                    parts=[types.Part(text=text[start : start + 7])],
                ),
            )
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part(text=text)],
            )
        )


@pytest.mark.parametrize(
    "model,format,transport", list(itertools.product(MODELS, FORMATS, TRANSPORTS))
)
async def test_all_configurations_render_ui_and_resume_after_frontend_action(
    monkeypatch,
    managed_agent,
    model,
    format,
    transport,
):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    agent = managed_agent(model, format, transport)
    fake_model = UiLlm(format=format, transport=transport)
    agent._adk_agent.model = fake_model
    incoming = ui_input(transport)

    async def collect(input):
        return [event async for event in agent.run(input)]

    events = await asyncio.wait_for(collect(incoming), timeout=10)
    assert events[0].type == EventType.RUN_STARTED
    assert events[-1].type == EventType.RUN_FINISHED
    assert not [event for event in events if event.type == EventType.RUN_ERROR]
    if transport == "markdown":
        content = "".join(
            event.delta
            for event in events
            if event.type == EventType.TEXT_MESSAGE_CONTENT
        )
        blocks = re.findall(r"```a2ui target=chat\n(.*?)\n```", content, re.DOTALL)
        operations = [operation for block in blocks for operation in json.loads(block)]
        assert content.startswith("Here is a card.") and content.endswith("Enjoy.")
        assert "a2ui-express" not in content and "root = " not in content
        assistant = AssistantMessage(id="answer-message", content=content)
        history = [*incoming.messages, assistant]
    else:
        calls = [event for event in events if event.type == EventType.TOOL_CALL_START]
        assert len(calls) == 1
        assert calls[0].tool_call_name == "render_ui"
        assert calls[0].tool_call_id == "model-render-ui"
        args = json.loads(
            "".join(
                event.delta
                for event in events
                if event.type == EventType.TOOL_CALL_ARGS
            )
        )
        assert args["target"] == "chat"
        assert "source" not in args
        operations = args["operations"]
        assert all(
            event.tool_call_id == "model-render-ui"
            for event in events
            if event.type in (EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END)
        )
        history = [
            *incoming.messages,
            AssistantMessage(
                id="answer-message",
                tool_calls=[
                    ToolCall(
                        id="model-render-ui",
                        function=FunctionCall(
                            name="render_ui",
                            arguments=json.dumps(args),
                        ),
                    )
                ],
            ),
            ToolMessage(
                id="render-result",
                tool_call_id="model-render-ui",
                content='{"status":"success","surfaceId":"answer"}',
            ),
        ]
    created = next(
        operation["createSurface"]
        for operation in operations
        if "createSurface" in operation
    )
    assert all(operation["version"] == "v1.0" for operation in operations)
    assert created["surfaceId"] == "answer"
    assert created["catalogId"] == "demo"
    assert created["components"] == expected_ui()[0]["createSurface"]["components"]

    # A real second ADK invocation receives the frontend result and user event.
    history.append(
        UserMessage(
            id="user-action",
            content='UI event: {"name":"choose","value":"Hello"}',
        )
    )
    followup = incoming.model_copy(update={"run_id": "second-run", "messages": history})
    resumed = await asyncio.wait_for(collect(followup), timeout=10)
    assert resumed[0].type == EventType.RUN_STARTED
    assert resumed[-1].type == EventType.RUN_FINISHED
    assert not [event for event in resumed if event.type == EventType.RUN_ERROR]
    assert "Updated after UI action" in "".join(
        event.delta for event in resumed if event.type == EventType.TEXT_MESSAGE_CONTENT
    )
    assert '"choose"' in str(fake_model.requests[-1].contents)
    if transport == "tool":
        assert "success" in str(fake_model.requests[-1].contents)


@pytest.mark.parametrize("failure", ["preparation", "compilation"])
async def test_express_errors_are_terminal_ag_ui_events_over_http(
    failure, managed_agent
):
    agent = managed_agent(MODELS[0], "express", "markdown")
    agent._adk_agent.model = UiLlm(
        format="express",
        transport="markdown",
        invalid_source=True,
    )
    incoming = ui_input("markdown")
    if failure == "preparation":
        incoming.forwarded_props = {}
    app = FastAPI()
    add_adk_fastapi_endpoint(app, agent, path="/run")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/run", json=incoming.model_dump(by_alias=True))
    assert response.status_code == 200
    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[0]["type"] == "RUN_STARTED"
    assert events[-1]["type"] == "RUN_ERROR"
    assert "RUN_FINISHED" not in [event["type"] for event in events]
    assert events[-1]["message"]
