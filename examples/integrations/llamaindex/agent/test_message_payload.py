"""Check the starter's AG-UI messages at the OpenAI request boundary."""

import json
import os
import unittest

import httpx
from ag_ui.core import (
    AssistantMessage,
    FunctionCall,
    RunAgentInput,
    ToolCall,
    ToolMessage,
    UserMessage,
)
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.agent import AGUIChatWorkflow
from llama_index.protocols.ag_ui.utils import ag_ui_message_to_llama_index_message

os.environ.setdefault("OPENAI_API_KEY", "test")
from src.agent import StarterOpenAI, change_theme_color


class MessagePayloadTest(unittest.TestCase):
    def test_first_and_second_turn_reject_unknown_openai_fields(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            for message in body["messages"]:
                if set(message) != {"role", "content"}:
                    return httpx.Response(
                        400, json={"error": {"message": "Unknown message field"}}
                    )
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "gpt-5-mini",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "Hello back"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 1,
                        "completion_tokens": 1,
                        "total_tokens": 2,
                    },
                },
            )

        client = httpx.Client(transport=httpx.MockTransport(respond))
        llm = OpenAI(model="gpt-5-mini", api_key="test", http_client=client)
        history = [UserMessage(id="user-1", content="Hello", role="user")]

        for turn in range(2):
            response = llm.chat(
                [ag_ui_message_to_llama_index_message(message) for message in history]
            )
            self.assertEqual(response.message.content, "Hello back")
            if turn == 0:
                history.extend(
                    [
                        AssistantMessage(
                            id="assistant-1", content="Hello back", role="assistant"
                        ),
                        UserMessage(id="user-2", content="Hello again", role="user"),
                    ]
                )

        self.assertEqual([len(body["messages"]) for body in requests], [1, 3])


class ToolResultPayloadTest(unittest.IsolatedAsyncioTestCase):
    async def test_frontend_tool_result_preserves_openai_tool_exchange(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            messages = body["messages"]
            if [message["role"] for message in messages] != [
                "developer",
                "user",
                "assistant",
                "tool",
            ]:
                return httpx.Response(400, json={"error": "Invalid role sequence"})
            if messages[2].get("tool_calls", [{}])[0].get("id") != "call-1":
                return httpx.Response(
                    400, json={"error": "Missing assistant tool call"}
                )
            if "<tool_call>" in (messages[2]["content"] or ""):
                return httpx.Response(400, json={"error": "Duplicated tool call"})
            if messages[3].get("tool_call_id") != "call-1":
                return httpx.Response(400, json={"error": "Unlinked tool result"})
            if "<state>" in messages[3]["content"]:
                return httpx.Response(
                    400, json={"error": "State attached to tool result"}
                )
            chunk = {
                "id": "chatcmpl-test",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": "gpt-5-mini",
                "choices": [
                    {"index": 0, "delta": {"content": "Done"}, "finish_reason": "stop"}
                ],
            }
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n",
            )

        messages = [
            UserMessage(id="user-1", content="Set the theme to orange", role="user"),
            AssistantMessage(
                id="assistant-1",
                content=None,
                role="assistant",
                tool_calls=[
                    ToolCall(
                        id="call-1",
                        function=FunctionCall(
                            name="change_theme_color",
                            arguments='{"theme_color":"#f97316"}',
                        ),
                    )
                ],
            ),
            ToolMessage(
                id="tool-1",
                content="Changing background to #f97316",
                role="tool",
                tool_call_id="call-1",
            ),
        ]
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        llm = StarterOpenAI(
            model="gpt-5-mini", api_key="test", async_http_client=client
        )
        workflow = AGUIChatWorkflow(
            llm=llm,
            frontend_tools=[change_theme_color],
            system_prompt="You can change the background color.",
            initial_state={"proverbs": []},
        )
        handler = workflow.run(
            input_data=RunAgentInput(
                thread_id="thread-1",
                run_id="run-2",
                messages=messages,
                state={"proverbs": []},
            )
        )
        async for _ in handler.stream_events():
            pass
        await handler

        self.assertEqual(
            [message["role"] for message in requests[0]["messages"]],
            ["developer", "user", "assistant", "tool"],
        )
        self.assertIn("<state>", requests[0]["messages"][1]["content"])
        self.assertIn("Set the theme to orange", requests[0]["messages"][1]["content"])
        self.assertEqual(requests[0]["messages"][2]["tool_calls"][0]["id"], "call-1")
        self.assertEqual(
            requests[0]["messages"][2]["tool_calls"][0]["function"],
            {"name": "change_theme_color", "arguments": '{"theme_color":"#f97316"}'},
        )
        self.assertEqual(requests[0]["messages"][3]["tool_call_id"], "call-1")
        self.assertEqual(
            requests[0]["messages"][3]["content"], "Changing background to #f97316"
        )


if __name__ == "__main__":
    unittest.main()
