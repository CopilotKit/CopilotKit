"""Exercise the actual FastAPI AG-UI endpoint without an LLM service."""

import json
import unittest

from fastapi.testclient import TestClient

from app import app


class AgentEndpointTest(unittest.TestCase):
    def test_echoes_user_message_as_ag_ui_stream(self):
        response = TestClient(app).post(
            "/ag-ui",
            json={
                "threadId": "thread-1",
                "runId": "run-1",
                "state": {},
                "messages": [
                    {"id": "message-1", "role": "user", "content": "Hello"}
                ],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            },
            headers={"origin": "http://127.0.0.1:5173"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/event-stream"))
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://127.0.0.1:5173",
        )
        events = [
            json.loads(line.removeprefix("data: "))
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        self.assertEqual(
            [event["type"] for event in events],
            [
                "RUN_STARTED",
                "TEXT_MESSAGE_START",
                "TEXT_MESSAGE_CONTENT",
                "TEXT_MESSAGE_END",
                "RUN_FINISHED",
            ],
        )
        self.assertEqual(events[2]["delta"], "You said: Hello")


if __name__ == "__main__":
    unittest.main()
