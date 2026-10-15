"""Exercise the A2UI router's model-facing schema with the official adapter."""

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from llama_index.core.llms import ChatMessage, ChatResponse, MessageRole
from llama_index.core.tools import ToolSelection
from llama_index.llms.openai import OpenAI

from agents import a2ui_dynamic


def test_injected_a2ui_components_reach_model_as_an_array(monkeypatch) -> None:
    model_schemas = []

    class RecordingLLM(OpenAI):
        async def astream_chat_with_tools(self, tools, chat_history=None, **kwargs):
            model_schemas.extend(tool.metadata.to_openai_tool() for tool in tools)

            async def response():
                yield ChatResponse(
                    message=ChatMessage(
                        role=MessageRole.ASSISTANT,
                        content="",
                        additional_kwargs={
                            "tool_calls": [
                                {
                                    "id": "render-1",
                                    "type": "function",
                                    "function": {
                                        "name": "render_a2ui",
                                        "arguments": json.dumps(
                                            {"surfaceId": "dashboard", "components": []}
                                        ),
                                    },
                                }
                            ]
                        },
                    ),
                    delta="",
                )

            return response()

        def get_tool_calls_from_response(self, response, **kwargs):
            return [
                ToolSelection(
                    tool_id="render-1",
                    tool_name="render_a2ui",
                    tool_kwargs={"surfaceId": "dashboard", "components": []},
                )
            ]

    monkeypatch.setattr(
        a2ui_dynamic, "OpenAI", lambda **kwargs: RecordingLLM(api_key="sk-test")
    )
    app = FastAPI()
    app.include_router(
        a2ui_dynamic._make_a2ui_router(
            a2ui_dynamic._a2ui_dynamic_workflow_factory()
        )
    )
    reply = TestClient(app).post(
        "/run",
        json={
            "threadId": "thread-1",
            "runId": "run-1",
            "state": {},
            "messages": [
                {"id": "user-1", "role": "user", "content": "Draw a dashboard"}
            ],
            "tools": [
                {
                    "name": "render_a2ui",
                    "description": "Render an A2UI surface",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "surfaceId": {"type": "string"},
                            "components": {
                                "type": "array",
                                "items": {"type": "object"},
                            },
                        },
                        "required": ["surfaceId", "components"],
                    },
                }
            ],
            "context": [],
            "forwardedProps": {},
        },
    )

    assert reply.status_code == 200
    assert "RUN_FINISHED" in reply.text
    assert '"type":"TOOL_CALL_CHUNK"' in reply.text
    assert '"toolCallName":"render_a2ui"' in reply.text
    render_schema = next(
        schema for schema in model_schemas if schema["function"]["name"] == "render_a2ui"
    )
    assert render_schema["function"]["parameters"]["properties"]["components"] == {
        "type": "array",
        "items": {"type": "object"},
    }
