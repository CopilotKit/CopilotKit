"""Exercise the production model options through the pinned LiteLLM serializer."""

import asyncio
import json
import sys
import unittest
from pathlib import Path

import httpx
import litellm
from openai import AsyncOpenAI

sys.path.insert(0, str(Path(__file__).parent / "src"))
from model import completion_options


class LunaRequestTest(unittest.IsolatedAsyncioTestCase):
    async def test_luna_tools_reach_openai_without_litellm_filtering_effort(self):
        captured = []

        async def respond(request):
            captured.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "id": "offline",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "gpt-6-luna",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "Sunny"},
                            "finish_reason": "stop",
                        }
                    ],
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            response = await litellm.acompletion(
                model="openai/gpt-6-luna",
                api_key="test-only",
                client=AsyncOpenAI(api_key="test-only", http_client=http),
                messages=[{"role": "user", "content": "Weather?"}],
                tools=[
                    {
                        "type": "function",
                        "function": {
                            "name": "weather",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
                **completion_options("openai/gpt-6-luna"),
            )
        self.assertEqual(response.choices[0].message.content, "Sunny")
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0]["model"], "gpt-6-luna")
        self.assertEqual(captured[0]["reasoning_effort"], "none")
        self.assertEqual(captured[0]["tools"][0]["function"]["name"], "weather")
        self.assertFalse(captured[0]["parallel_tool_calls"])
        self.assertNotIn("allowed_openai_params", captured[0])

    def test_provider_overrides_keep_their_existing_options(self):
        self.assertEqual(completion_options("gemini/gemini-3.8-flash"), {})
        for model in ("anthropic/claude-opus-4-8", "openai/custom-model"):
            self.assertEqual(completion_options(model), {"parallel_tool_calls": False})


if __name__ == "__main__":
    unittest.main()
