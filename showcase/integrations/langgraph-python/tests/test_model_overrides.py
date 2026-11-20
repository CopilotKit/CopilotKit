"""Inspect actual OpenAI requests from the A2UI model builders."""

import importlib
import json
import sys
from types import SimpleNamespace

import httpx
import pytest
from langchain_core.messages import HumanMessage


@pytest.mark.parametrize("module_name", ["a2ui_dynamic", "recovery_agent"])
@pytest.mark.parametrize("model_id", [None, "gpt-4o"])
def test_a2ui_models_preserve_chat_model_overrides(monkeypatch, module_name, model_id):
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-key")
    if model_id is None:
        monkeypatch.delenv("OPENAI_MODEL", raising=False)
    else:
        monkeypatch.setenv("OPENAI_MODEL", model_id)

    # Capture the actual builder's models without starting an agent graph.
    monkeypatch.setattr(
        "langchain.agents.create_agent", lambda **kwargs: SimpleNamespace(**kwargs)
    )
    path = f"src.agents.{module_name}"
    sys.modules.pop(path, None)
    module = importlib.import_module(path)
    models = [module.graph.model]
    if module_name == "recovery_agent":
        models.append(module._A2UI_MODEL)

    observed = []

    def send(client, request, **kwargs):
        observed.append(json.loads(request.content))
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(
            200,
            request=request,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 0,
                "model": model_id or "gpt-6-luna",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    monkeypatch.setattr(httpx.Client, "send", send)
    try:
        for model in models:
            # Tools expose Luna's Chat API constraint while exercising the
            # installed LangChain and OpenAI serializers for each builder.
            model.bind_tools(
                [
                    {
                        "type": "function",
                        "function": {
                            "name": "draw",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ]
            ).invoke([HumanMessage(content="Draw the dashboard")])
        assert len(observed) == len(models)
        for request in observed:
            assert request["model"] == (model_id or "gpt-6-luna")
            assert request["tools"][0]["function"]["name"] == "draw"
            if model_id is None:
                assert request["reasoning_effort"] == "none"
            else:
                assert "reasoning_effort" not in request
    finally:
        sys.modules.pop(path, None)
