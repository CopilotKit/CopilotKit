"""Contracts for CrewAI Flows backing state and multimodal D6 cells."""

from pathlib import Path
from types import SimpleNamespace

import pytest


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"
MULTIMODAL_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-multimodal" / "route.ts"
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


def test_server_and_runtime_register_dedicated_flow_routes():
    server = AGENT_SERVER.read_text()
    route = MULTIMODAL_ROUTE.read_text()

    assert 'shared_state_read_flow, "/shared-state-read"' in server
    assert 'shared_state_streaming_flow, "/shared-state-streaming"' in server
    assert 'multimodal_flow, "/multimodal"' in server
    assert "${AGENT_URL}/multimodal" in route
