"""Exercise the real OpenAI serializer at the integration boundary."""

import importlib
import json

import httpx
import openai
import pytest
from fastapi import FastAPI


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["gpt-6-luna", "gpt-4o"])
@pytest.mark.parametrize(
    "module_name",
    [
        "agui_adapter",
        "gen_ui_agent",
        "shared_state_read_write",
        "a2ui_fixed_agent",
        "mcp_apps_agent",
        "multimodal_agent",
        "byoc_hashbrown_agent",
    ],
)
async def test_chat_model_override_omits_unsupported_reasoning(
    monkeypatch, model, module_name
):
    module = importlib.import_module(f"agents.{module_name}")
    requests = []

    def transport(request):
        body = json.loads(request.content)
        requests.append(body)
        if body.get("stream"):
            chunk = {
                "id": "chatcmpl-test",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": model,
                "choices": [
                    {"index": 0, "delta": {"content": "{}"}, "finish_reason": None}
                ],
            }
            return httpx.Response(
                200,
                text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 0,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    original = openai.AsyncOpenAI
    client = original(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    monkeypatch.setenv("LANGROID_MODEL", model)
    monkeypatch.setenv("MULTIMODAL_MODEL", model)
    messages = [{"role": "user", "content": "Hello"}]
    try:
        if module_name == "agui_adapter":
            await module._call_openai(messages, [], model)
        elif module_name in {"gen_ui_agent", "shared_state_read_write"}:
            await module._call_openai(messages, [])
        elif module_name == "byoc_hashbrown_agent":
            assert (
                "".join(
                    [
                        part
                        async for part in module._stream_json_response(
                            system_prompt="Return JSON",
                            user_messages=messages,
                            model=model,
                        )
                    ]
                )
                == "{}"
            )
        else:
            app = FastAPI()
            app.add_api_route("/", module.handle_run, methods=["POST"])
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app), base_url="http://test"
            ) as browser:
                response = await browser.post(
                    "/",
                    json={
                        "threadId": "thread",
                        "runId": "run",
                        "state": {},
                        "messages": [{"id": "user", **messages[0]}],
                        "tools": [],
                        "context": [],
                        "forwardedProps": {},
                    },
                )
                assert response.status_code == 200
        assert len(requests) == 1
        assert requests[0]["model"] == model
        if model == "gpt-6-luna":
            assert requests[0]["reasoning_effort"] == "none"
        else:
            assert "reasoning_effort" not in requests[0]
    finally:
        await client.close()
