"""Check the starter's AG-UI messages at the OpenAI request boundary."""

import json
import unittest

import httpx
from ag_ui.core import AssistantMessage, UserMessage
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.utils import ag_ui_message_to_llama_index_message


class MessagePayloadTest(unittest.TestCase):
    def test_first_and_second_turn_reject_unknown_openai_fields(self):
        requests = []

        def respond(request):
            body = json.loads(request.content)
            requests.append(body)
            for message in body["messages"]:
                if set(message) != {"role", "content"}:
                    return httpx.Response(400, json={"error": {"message": "Unknown message field"}})
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
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
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
                        AssistantMessage(id="assistant-1", content="Hello back", role="assistant"),
                        UserMessage(id="user-2", content="Hello again", role="user"),
                    ]
                )

        self.assertEqual([len(body["messages"]) for body in requests], [1, 3])


if __name__ == "__main__":
    unittest.main()
