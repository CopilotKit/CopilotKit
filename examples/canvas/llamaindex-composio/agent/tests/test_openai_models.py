"""Exercise the canvas agent's OpenAI class with its locked SDK dependencies."""

import importlib
import json
import os
import unittest
from unittest.mock import patch

import httpx
from llama_index.core.llms import ChatMessage
from llama_index.core.tools import FunctionTool
from llama_index.llms.openai import OpenAI as SDKOpenAI


class LunaCompatibilityTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test", "COMPOSIO_TOOL_IDS": ""},
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        # Import the application module so the test also checks the actual wiring.
        self.agent = importlib.import_module("agent.agent")
        self.requests = []

    def capture(self, request):
        body = json.loads(request.content)
        self.requests.append(body)
        if body.get("stream"):
            chunk = {
                "id": "chat-test",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": "gpt-6-luna",
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
            }
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n",
            )
        return httpx.Response(
            200,
            json={
                "id": "chat-test",
                "object": "chat.completion",
                "created": 0,
                "model": "gpt-6-luna",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    def assert_luna_request(self):
        self.assertEqual(len(self.requests), 1)
        body = self.requests[0]
        self.assertEqual(body["model"], "gpt-6-luna")
        self.assertEqual(body["reasoning_effort"], "none")
        self.assertEqual(body["max_completion_tokens"], 64)
        self.assertNotIn("max_tokens", body)
        self.assertEqual(body["tools"][0]["function"]["name"], "createItem")

    def test_luna_metadata_and_tokenizer(self):
        llm = self.agent.OpenAI(model="gpt-6-luna", max_tokens=64)
        self.assertEqual(llm.metadata.context_window, 1_050_000)
        self.assertEqual(llm.metadata.num_output, 64)
        self.assertTrue(llm.metadata.is_chat_model)
        self.assertTrue(llm.metadata.is_function_calling_model)
        self.assertEqual(llm._tokenizer.name, "o200k_base")
        self.assertTrue(llm._tokenizer.encode("Create a canvas note"))

    def test_tool_request_reaches_http_with_luna_parameters(self):
        with httpx.Client(transport=httpx.MockTransport(self.capture)) as client:
            llm = self.agent.OpenAI(
                model="gpt-6-luna", max_tokens=64, http_client=client
            )
            result = llm.chat_with_tools(
                [FunctionTool.from_defaults(fn=self.agent.createItem)],
                chat_history=[ChatMessage(role="user", content="Create a note")],
            )
        self.assertEqual(result.message.content, "OK")
        self.assert_luna_request()

    async def test_async_tool_stream_reaches_http_with_luna_parameters(self):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(self.capture)
        ) as client:
            llm = self.agent.OpenAI(
                model="gpt-6-luna", max_tokens=64, async_http_client=client
            )
            stream = await llm.astream_chat_with_tools(
                [FunctionTool.from_defaults(fn=self.agent.createItem)],
                chat_history=[ChatMessage(role="user", content="Create a note")],
            )
            responses = [response async for response in stream]
        self.assertEqual(responses[-1].message.content, "OK")
        self.assert_luna_request()

    def test_other_models_keep_sdk_metadata_and_tokenizer(self):
        llm = self.agent.OpenAI(model="gpt-4o")
        sdk = SDKOpenAI(model="gpt-4o")
        self.assertEqual(llm.metadata, sdk.metadata)
        self.assertEqual(llm._tokenizer.name, sdk._tokenizer.name)
        self.assertEqual(llm._get_model_kwargs(), sdk._get_model_kwargs())


if __name__ == "__main__":
    unittest.main()
