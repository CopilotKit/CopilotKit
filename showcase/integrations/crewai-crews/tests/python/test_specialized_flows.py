"""Contracts for CrewAI Flows backing state and multimodal D6 cells."""

from pathlib import Path
from types import SimpleNamespace

import pytest


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"
MULTIMODAL_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-multimodal" / "route.ts"
)
A2UI_RECOVERY_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-a2ui-recovery" / "route.ts"
)
MAIN_RUNTIME_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit" / "route.ts"
)


def _response(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


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

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_predict(items):
        predicted.extend(items)
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_predict_state", fake_predict)

    await flow.write()

    assert predicted == [
        module.StateItem(
            state_key="document",
            tool="write_document",
            tool_argument="document",
        )
    ]
    assert flow.state.document == document
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

    async def fake_responses(**kwargs):
        calls.append(kwargs)
        return object()

    async def fake_stream(_value):
        return responses.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "copilotkit_responses", fake_responses)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert calls[0]["reasoning"] == {"effort": "medium", "summary": "detailed"}
    assert emitted[0][0] == "call_reasoned_weather"
    assert flow.state.messages[-1]["content"] == "Pack for the weather."


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
    assert captured["model"] == "openai/gpt-4o"


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


def test_server_and_runtime_register_dedicated_flow_routes():
    server = AGENT_SERVER.read_text()
    route = MULTIMODAL_ROUTE.read_text()
    a2ui_route = A2UI_RECOVERY_ROUTE.read_text()

    assert 'shared_state_read_flow, "/shared-state-read"' in server
    assert 'shared_state_streaming_flow, "/shared-state-streaming"' in server
    assert 'multimodal_flow, "/multimodal"' in server
    assert 'a2ui_recovery_flow, "/a2ui-recovery"' in server
    assert 'tool_rendering_reasoning_flow, "/tool-rendering-reasoning"' in server
    assert "${AGENT_URL}/multimodal" in route
    assert "${AGENT_URL}/a2ui-recovery" in a2ui_route
    assert "injectA2UITool: false" in a2ui_route


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
    }
    for agent_name, path in expected_routes.items():
        assert f'agents["{agent_name}"] = createAgent("{path}")' in route
