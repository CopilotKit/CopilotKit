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
from src.agent import StarterOpenAI, change_theme_color, get_weather


def stream_response():
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


def validate_openai_messages(messages):
    """Reject unknown fields and unmatched tool calls at the request boundary."""
    allowed = {
        "developer": {"role", "content"},
        "system": {"role", "content"},
        "user": {"role", "content"},
        "assistant": {"role", "content", "tool_calls"},
        "tool": {"role", "content", "tool_call_id"},
    }
    pending = set()
    for index, message in enumerate(messages):
        role = message.get("role")
        if role not in allowed or set(message) - allowed[role]:
            return f"Unknown parameter: messages[{index}]"
        if pending and (role != "tool" or message.get("tool_call_id") not in pending):
            return f"Unanswered tool calls before messages[{index}]"
        if role == "tool":
            if not pending:
                return f"Unexpected tool result at messages[{index}]"
            pending.remove(message["tool_call_id"])
        elif role == "assistant" and message.get("tool_calls"):
            pending = {call["id"] for call in message["tool_calls"]}
    return "Unanswered tool calls" if pending else None


class MessagePayloadTest(unittest.TestCase):
    def test_first_and_second_turn_reject_unknown_openai_fields(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            error = validate_openai_messages(body["messages"])
            if error:
                return httpx.Response(400, json={"error": {"message": error}})
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
    async def test_backend_tool_loop_keeps_openai_call_and_result_paired(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            error = validate_openai_messages(body["messages"])
            if error:
                return httpx.Response(400, json={"error": error})
            if len(requests) > 1:
                return stream_response()
            call = {
                "index": 0,
                "id": "call-weather",
                "type": "function",
                "function": {"name": "get_weather", "arguments": '{"location":"Paris"}'},
            }
            chunks = [
                {"role": "assistant", "tool_calls": [call]},
                {},
            ]
            events = []
            for index, delta in enumerate(chunks):
                chunk = {
                    "id": "chatcmpl-test",
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": "gpt-5-mini",
                    "choices": [
                        {
                            "index": 0,
                            "delta": delta,
                            "finish_reason": "tool_calls" if index else None,
                        }
                    ],
                }
                events.append(f"data: {json.dumps(chunk)}\n\n")
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text="".join(events) + "data: [DONE]\n\n",
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        workflow = AGUIChatWorkflow(
            llm=StarterOpenAI(
                model="gpt-5-mini", api_key="test", async_http_client=client
            ),
            backend_tools=[get_weather],
            system_prompt="You can get the weather.",
        )
        handler = workflow.run(
            input_data=RunAgentInput(
                thread_id="thread-1",
                run_id="run-weather",
                messages=[UserMessage(id="user-1", content="Weather in Paris?", role="user")],
                state={},
            )
        )
        async for _ in handler.stream_events():
            pass
        await handler
        self.assertEqual(len(requests), 2)
        self.assertEqual(
            [message["role"] for message in requests[1]["messages"]],
            ["developer", "user", "assistant", "tool"],
        )
        self.assertEqual(
            requests[1]["messages"][2]["tool_calls"][0]["id"], "call-weather"
        )
        self.assertEqual(requests[1]["messages"][3]["tool_call_id"], "call-weather")

    async def test_frontend_tool_result_preserves_openai_tool_exchange(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            messages = body["messages"]
            error = validate_openai_messages(messages)
            if error:
                return httpx.Response(400, json={"error": error})
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
            return stream_response()

        messages = [
            UserMessage(id="user-1", content="Set the theme to orange", role="user"),
            AssistantMessage(
                id="assistant-1",
                content="Sure.",
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
        self.assertEqual(requests[0]["messages"][2]["content"], "Sure.")
        self.assertEqual(
            requests[0]["messages"][2]["tool_calls"][0]["function"],
            {"name": "change_theme_color", "arguments": '{"theme_color":"#f97316"}'},
        )
        self.assertEqual(requests[0]["messages"][3]["tool_call_id"], "call-1")
        self.assertEqual(
            requests[0]["messages"][3]["content"], "Changing background to #f97316"
        )

    async def test_interrupted_frontend_call_stays_text_without_tool_result(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            messages = body["messages"]
            error = validate_openai_messages(messages)
            if error:
                return httpx.Response(400, json={"error": error})
            if [message["role"] for message in messages] != [
                "developer",
                "user",
                "assistant",
                "user",
            ] or any(message.get("tool_calls") for message in messages):
                return httpx.Response(400, json={"error": "Unanswered tool call"})
            return stream_response()

        messages = [
            UserMessage(id="user-1", content="Set the theme", role="user"),
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
            UserMessage(id="user-2", content="Try again", role="user"),
        ]
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        workflow = AGUIChatWorkflow(
            llm=StarterOpenAI(
                model="gpt-5-mini", api_key="test", async_http_client=client
            ),
            frontend_tools=[change_theme_color],
            system_prompt="You can change the background color.",
        )
        handler = workflow.run(
            input_data=RunAgentInput(
                thread_id="thread-1", run_id="run-3", messages=messages, state={}
            )
        )
        async for _ in handler.stream_events():
            pass
        await handler
        self.assertIn("<tool_call>", requests[0]["messages"][2]["content"])

    async def test_partly_answered_parallel_calls_have_no_orphaned_tool_result(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            error = validate_openai_messages(body["messages"])
            if error:
                return httpx.Response(400, json={"error": error})
            return stream_response()

        messages = [
            UserMessage(
                id="user-1", content="Change the theme and add a proverb", role="user"
            ),
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
                    ),
                    ToolCall(
                        id="call-2",
                        function=FunctionCall(
                            name="add_proverb",
                            arguments='{"proverb":"A stitch in time."}',
                        ),
                    ),
                ],
            ),
            ToolMessage(
                id="tool-1",
                content="Changing background to #f97316",
                role="tool",
                tool_call_id="call-1",
            ),
            UserMessage(id="user-2", content="Try again", role="user"),
        ]
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        workflow = AGUIChatWorkflow(
            llm=StarterOpenAI(
                model="gpt-5-mini", api_key="test", async_http_client=client
            ),
            frontend_tools=[change_theme_color],
            system_prompt="You can change the background color.",
        )
        handler = workflow.run(
            input_data=RunAgentInput(
                thread_id="thread-1", run_id="run-5", messages=messages, state={}
            )
        )
        async for _ in handler.stream_events():
            pass
        await handler
        outbound = requests[0]["messages"]
        self.assertEqual(
            [message["role"] for message in outbound],
            ["developer", "user", "assistant", "user", "user"],
        )
        self.assertIn("<tool_call>", outbound[2]["content"])
        self.assertEqual(outbound[3]["content"], "Changing background to #f97316")

    async def test_later_turn_drops_state_from_old_tool_result(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            messages = body["messages"]
            error = validate_openai_messages(messages)
            if error:
                return httpx.Response(400, json={"error": error})
            state_count = sum(
                (message.get("content") or "").count("<state>")
                for message in messages
            )
            if state_count != 1:
                return httpx.Response(400, json={"error": "Repeated state"})
            return stream_response()

        messages = [
            UserMessage(id="user-1", content="Set the theme", role="user"),
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
                content="<state>\n{'proverbs': ['old']}\n</state>\n\nChanging background to #f97316\n",
                role="tool",
                tool_call_id="call-1",
            ),
            UserMessage(id="user-2", content="What next?", role="user"),
        ]
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        workflow = AGUIChatWorkflow(
            llm=StarterOpenAI(
                model="gpt-5-mini", api_key="test", async_http_client=client
            ),
            frontend_tools=[change_theme_color],
            system_prompt="You can change the background color.",
        )
        handler = workflow.run(
            input_data=RunAgentInput(
                thread_id="thread-1",
                run_id="run-4",
                messages=messages,
                state={"proverbs": ["current"]},
            )
        )
        async for _ in handler.stream_events():
            pass
        await handler
        outbound = requests[0]["messages"]
        self.assertEqual(
            [message["role"] for message in outbound],
            ["developer", "user", "assistant", "tool", "user"],
        )
        self.assertNotIn("<state>", outbound[3]["content"])
        self.assertNotIn("old", json.dumps(outbound))
        self.assertIn("current", outbound[4]["content"])


if __name__ == "__main__":
    unittest.main()
