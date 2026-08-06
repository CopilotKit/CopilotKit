"""Contracts for CrewAI Flows backing state and multimodal D6 cells."""

import json
import re

from pathlib import Path
from types import SimpleNamespace

import pytest


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"
CONVERSATIONAL_FLOWS = INTEGRATION_ROOT / "src" / "agents" / "conversational_flows.py"
MULTIMODAL_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-multimodal" / "route.ts"
)
MULTIMODAL_PAGE = INTEGRATION_ROOT / "src" / "app" / "demos" / "multimodal" / "page.tsx"
A2UI_RECOVERY_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-a2ui-recovery" / "route.ts"
)
MAIN_RUNTIME_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit" / "route.ts"
)
OPEN_GEN_UI_RUNTIME_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-ogui" / "route.ts"
)


def _response(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.mark.asyncio
async def test_reasoning_stream_persists_current_trace_for_authoritative_snapshot(
    monkeypatch,
):
    from agents import tool_rendering_reasoning as module

    class FakeStream:
        def __init__(self):
            self._chunks = iter(
                [
                    {
                        "choices": [
                            {
                                "delta": {
                                    "reasoning_content": "Inspect the first tool, ",
                                }
                            }
                        ]
                    },
                    {
                        "choices": [
                            {
                                "delta": {
                                    "reasoning_content": "then compare the result.",
                                }
                            }
                        ]
                    },
                ]
            )

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._chunks)
            except StopIteration as error:
                raise StopAsyncIteration from error

    async def fake_stream(stream):
        async for _chunk in stream:
            pass
        return _response({"role": "assistant", "content": "Compared."})

    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    flow = module.ToolRenderingReasoningFlow()
    flow.state.messages = [{"role": "user", "content": "Compare them."}]

    response = await module._stream_with_snapshot_reasoning(flow, FakeStream())

    assert response.choices[0].message["content"] == "Compared."
    assert flow.state.messages[-1]["role"] == "reasoning"
    assert flow.state.messages[-1]["content"] == (
        "Inspect the first tool, then compare the result."
    )
    assert flow.state.messages[-1]["id"]


@pytest.mark.asyncio
async def test_shared_state_read_injects_recipe_into_model_context(monkeypatch):
    from agents import shared_state_read as module

    flow = module.SharedStateReadFlow()
    flow.state.recipe = {
        "title": "Weeknight pasta",
        "ingredients": ["spinach", "tomatoes"],
    }
    flow.state.messages = [{"role": "user", "content": "Make it healthier."}]
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "Add vegetables."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert "Weeknight pasta" in captured["messages"][0]["content"]
    assert "spinach" in captured["messages"][0]["content"]
    assert flow.state.messages[-1]["content"] == "Add vegetables."


@pytest.mark.asyncio
async def test_shared_state_streaming_predicts_and_persists_document(monkeypatch):
    from agents import shared_state_streaming as module

    flow = module.SharedStateStreamingFlow()
    flow.state.messages = [{"role": "user", "content": "Write a poem."}]
    document = "Amber leaves drift quietly across the patient autumn street."
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "Writing now.",
                "tool_calls": [
                    {
                        "id": "call_write_document",
                        "type": "function",
                        "function": {
                            "name": "write_document",
                            "arguments": '{"document":"' + document + '"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Done."}),
    ]
    predicted = []
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_predict(items):
        predicted.extend(items)
        return True

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_predict_state", fake_predict)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.write()

    assert predicted == [
        module.StateItem(
            state_key="document",
            tool="write_document",
            tool_argument="document",
        )
    ]
    assert flow.state.document == document
    assert emitted == [("call_write_document", "Document written to shared state.")]
    assert flow.state.messages[-1]["content"] == "Done."


@pytest.mark.asyncio
async def test_tool_rendering_emits_backend_tool_result_before_narration(monkeypatch):
    from agents import tool_rendering as module

    flow = module.ToolRenderingFlow()
    flow.state.messages = [{"role": "user", "content": "What's the weather in Tokyo?"}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_weather",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location":"Tokyo"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Tokyo is sunny."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(tool_call_id, content, **kwargs):
        emitted.append((tool_call_id, content, kwargs))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert emitted[0][0] == "call_weather"
    assert '"temperature"' in emitted[0][1]
    assert flow.state.messages[-1]["content"] == "Tokyo is sunny."


@pytest.mark.asyncio
async def test_tool_rendering_reasoning_combines_reasoning_and_tool_results(
    monkeypatch,
):
    from agents import tool_rendering_reasoning as module

    flow = module.ToolRenderingReasoningFlow()
    flow.state.messages = [{"role": "user", "content": "Weather in Tokyo?"}]
    responses = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_reasoned_weather",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location":"Tokyo"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Pack for the weather."}),
    ]
    calls = []
    emitted = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)

        async def empty_stream():
            if False:
                yield None

        return empty_stream()

    async def fake_stream(_value):
        return responses.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert calls[0]["reasoning_effort"] == "medium"
    assert calls[0]["stream"] is True
    assert emitted[0][0] == "call_reasoned_weather"
    assert flow.state.messages[-1]["content"] == "Pack for the weather."


@pytest.mark.asyncio
async def test_frontend_tool_flow_suspends_for_browser_owned_result(monkeypatch):
    from agents import frontend_tool_flow as module

    flow = module.FrontendToolFlow()
    flow.state.messages = [{"role": "user", "content": "Search my notes."}]
    tool_message = {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "call_query_notes",
                "type": "function",
                "function": {
                    "name": "query_notes",
                    "arguments": '{"keyword":"planning"}',
                },
            }
        ],
    }
    captured = []

    async def fake_completion(**kwargs):
        captured.append(kwargs)
        return object()

    async def fake_stream(_value):
        return _response(tool_message)

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert len(captured) == 1
    assert flow.state.messages[-1] == tool_message
    assert not any(message.get("role") == "tool" for message in flow.state.messages)


@pytest.mark.asyncio
async def test_multimodal_flow_preserves_converted_content_blocks(monkeypatch):
    from agents import multimodal_flow as module

    flow = module.MultimodalFlow()
    content = [
        {"type": "text", "text": "What is in this image?"},
        {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,AAAA"},
        },
    ]
    flow.state.messages = [{"role": "user", "content": content}]
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "An image."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert captured["messages"][-1]["content"] == content
    assert captured["model"] == "openai/gpt-5.4"


@pytest.mark.asyncio
async def test_a2ui_recovery_runs_alpha_tool_and_persists_envelope(monkeypatch):
    from agents import a2ui_recovery_flow as module

    flow = module.A2UIRecoveryFlow()
    flow.state.messages = [
        {"role": "user", "content": "Build a self-healing dashboard."}
    ]
    outer_call = {
        "id": "call_generate_a2ui",
        "type": "function",
        "function": {"name": "generate_a2ui", "arguments": '{"intent":"create"}'},
    }
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [outer_call],
            }
        ),
        _response({"role": "assistant", "content": "Recovered."}),
    ]
    tool_runs = []

    class FakeA2UITool:
        tool_name = "generate_a2ui"
        schema = {"type": "function", "function": {"name": "generate_a2ui"}}

        async def run(self, args, **kwargs):
            tool_runs.append((args, kwargs))
            return '{"a2ui_operations":[]}'

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    monkeypatch.setattr(
        module, "get_a2ui_tools", lambda *_args, **_kwargs: FakeA2UITool()
    )
    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.render()

    assert tool_runs[0][0] == {"intent": "create"}
    assert tool_runs[0][1]["tool_call_id"] == "call_generate_a2ui"
    assert flow.state.messages[-2]["content"] == '{"a2ui_operations":[]}'
    assert flow.state.messages[-1]["content"] == "Recovered."


@pytest.mark.asyncio
async def test_a2ui_fixed_flow_emits_backend_tool_result(monkeypatch):
    from agents import a2ui_fixed as module

    flow = module.A2UIFixedFlow()
    flow.state.messages = [{"role": "user", "content": "Find SFO to JFK."}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_display_flight",
                        "type": "function",
                        "function": {
                            "name": "display_flight",
                            "arguments": (
                                '{"origin":"SFO","destination":"JFK",'
                                '"airline":"United","price":"$289"}'
                            ),
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Flight rendered."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, json.loads(content)))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert emitted[0][0] == "call_display_flight"
    assert emitted[0][1]["a2ui_operations"]
    assert flow.state.messages[-1]["content"] == "Flight rendered."


@pytest.mark.asyncio
async def test_beautiful_chat_flow_emits_search_flights_a2ui_result(monkeypatch):
    from agents import beautiful_chat_flow as module

    flow = module.BeautifulChatFlow()
    flow.state.messages = [{"role": "user", "content": "Find flights."}]
    flight = {
        "airline": "United Airlines",
        "airlineLogo": "https://example.com/united.png",
        "flightNumber": "UA231",
        "origin": "SFO",
        "destination": "JFK",
        "date": "Tue, May 6",
        "departureTime": "08:00",
        "arrivalTime": "16:30",
        "duration": "5h 30m",
        "status": "On Time",
        "statusColor": "#22c55e",
        "price": "$349",
        "currency": "USD",
    }
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_search_flights",
                        "type": "function",
                        "function": {
                            "name": "search_flights",
                            "arguments": json.dumps({"flights": [flight]}),
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "One flight shown."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, json.loads(content)))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert emitted[0][0] == "call_search_flights"
    assert emitted[0][1]["a2ui_operations"]
    assert flow.state.messages[-1]["content"] == "One flight shown."


@pytest.mark.asyncio
async def test_gen_ui_agent_closes_each_backend_step_tool_call(monkeypatch):
    from agents import gen_ui_agent as module

    flow = module.GenUiAgentFlow()
    flow.state.messages = [{"role": "user", "content": "Plan a launch."}]
    steps = [{"id": "one", "title": "Plan", "status": "pending"}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_steps",
                        "type": "function",
                        "function": {
                            "name": "set_steps",
                            "arguments": json.dumps({"steps": steps}),
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Plan ready."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit_state(_state):
        return True

    async def fake_emit_result(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_state", fake_emit_state)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit_result)

    await flow.chat()

    assert emitted == [("call_steps", "Published 1 step(s).")]
    assert flow.state.messages[-1]["content"] == "Plan ready."


@pytest.mark.asyncio
async def test_gen_ui_agent_sends_only_the_active_user_turn(monkeypatch):
    from agents import gen_ui_agent as module

    flow = module.GenUiAgentFlow()
    flow.state.messages = [
        {"role": "user", "content": "Organize a team offsite."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_d5_set_steps_offsite_007",
                    "type": "function",
                    "function": {"name": "set_steps", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_d5_set_steps_offsite_007",
            "content": "Published 3 step(s).",
        },
        {
            "role": "assistant",
            "content": "Offsite locked in.",
        },
        {
            "role": "user",
            "content": "Research our top competitor and summarize weaknesses.",
        },
    ]
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "Starting research."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    serialized = json.dumps(captured["messages"])
    assert "Research our top competitor" in serialized
    assert "call_d5_set_steps_offsite_007" not in serialized
    assert "Offsite locked in" not in serialized


def test_server_and_runtime_register_dedicated_flow_routes():
    server = AGENT_SERVER.read_text()
    conversational_flows = CONVERSATIONAL_FLOWS.read_text()
    route = MULTIMODAL_ROUTE.read_text()
    a2ui_route = A2UI_RECOVERY_ROUTE.read_text()
    open_gen_ui_route = OPEN_GEN_UI_RUNTIME_ROUTE.read_text()

    assert "CONVERSATIONAL_FLOW_TYPES" in server
    assert 'f"/conversational_flows/{feature}"' in server
    for feature in (
        "shared-state-read",
        "a2ui-fixed-schema",
        "beautiful-chat",
        "shared-state-streaming",
        "multimodal",
        "a2ui-recovery",
        "tool-rendering-reasoning",
    ):
        assert f'"{feature}": _conversational_type(' in conversational_flows
    assert "${AGENT_URL}/conversational_flows/multimodal" in route
    assert "${AGENT_URL}/conversational_flows/a2ui-recovery" in a2ui_route
    assert "injectA2UITool: false" in a2ui_route
    assert "`${AGENT_URL}/conversational_flows/frontend-tools`" in open_gen_ui_route


def test_byoc_hashbrown_legacy_route_is_operational():
    page = INTEGRATION_ROOT / "src" / "app" / "demos" / "byoc-hashbrown" / "page.tsx"
    declarative_page = (
        INTEGRATION_ROOT
        / "src"
        / "app"
        / "demos"
        / "declarative-hashbrown"
        / "page.tsx"
    )

    assert page.exists()
    assert "declarative-hashbrown/page" in page.read_text()
    source = declarative_page.read_text()
    assert 'runtimeUrl="/api/copilotkit-byoc-hashbrown"' in source
    assert 'agent="byoc-hashbrown-demo"' in source
    assert 'data-testid="byoc-hashbrown-root"' in source


def test_multimodal_page_uses_alpha_native_attachment_conversion():
    page = MULTIMODAL_PAGE.read_text()

    assert "LegacyConverterShim" not in page
    assert "MultimodalChat" in page


def test_main_runtime_routes_specialized_agents_to_their_native_flows():
    route = MAIN_RUNTIME_ROUTE.read_text()

    expected_routes = {
        "shared-state-read": "/shared-state-read",
        "shared-state-write": "/shared-state-read-write",
        "shared-state-streaming": "/shared-state-streaming",
        "shared-state-read-write": "/shared-state-read-write",
        "subagents": "/subagents",
        "tool-rendering": "/tool-rendering",
        "tool-rendering-default-catchall": "/tool-rendering",
        "tool-rendering-custom-catchall": "/tool-rendering",
        "tool-rendering-reasoning-chain": "/tool-rendering-reasoning",
        "frontend-tools-async": "/frontend-tools",
        "headless-complete": "/frontend-tools",
        "open-gen-ui": "/frontend-tools",
        "open-gen-ui-advanced": "/frontend-tools",
    }
    for agent_name, path in expected_routes.items():
        assert re.search(
            rf'agents\["{re.escape(agent_name)}"\]\s*=\s*createAgent\(\s*"{re.escape(path)}"',
            route,
        )
