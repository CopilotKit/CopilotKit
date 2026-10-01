import json
import unittest
from importlib.metadata import version

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message
from httpx import ASGITransport, AsyncClient

from agent.__main__ import build_app


class DeterministicExecutor(AgentExecutor):
    async def execute(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        await event_queue.enqueue_event(
            new_agent_text_message(
                "Rendered",
                context_id=context.context_id,
                task_id=context.task_id,
            )
        )

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise NotImplementedError


class A2AServerContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_discovery_and_streaming_use_the_real_asgi_application(self):
        self.assertEqual(version("a2a-sdk"), "0.3.26")
        base_url = "http://a2a-agent.internal"
        app = build_app(base_url, executor=DeterministicExecutor())

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=base_url
        ) as client:
            discovery = await client.get("/.well-known/agent.json")
            self.assertEqual(discovery.status_code, 200)
            card = discovery.json()
            self.assertEqual(card["name"], "UI Generator")
            self.assertEqual(card["url"], base_url)
            self.assertTrue(card["capabilities"]["streaming"])

            stream = await client.post(
                "/",
                json={
                    "jsonrpc": "2.0",
                    "id": "runtime-contract",
                    "method": "message/stream",
                    "params": {
                        "message": {
                            "kind": "message",
                            "messageId": "request-message",
                            "role": "user",
                            "parts": [{"kind": "text", "text": "Render a card"}],
                        }
                    },
                },
            )

        self.assertEqual(stream.status_code, 200)
        self.assertTrue(stream.headers["content-type"].startswith("text/event-stream"))
        events = [
            json.loads(line.removeprefix("data: "))
            for line in stream.text.splitlines()
            if line.startswith("data: ")
        ]
        self.assertTrue(events)
        self.assertTrue(
            any("Rendered" in json.dumps(event) for event in events),
            events,
        )


if __name__ == "__main__":
    unittest.main()
