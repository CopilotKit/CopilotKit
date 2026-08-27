from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import server


class ServerContractTests(unittest.TestCase):
    def test_health_reports_process_local_persistence(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            response = TestClient(server.app).get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "service": "cloudplot-agent",
                "persistence": "process-memory",
            },
        )

    def test_health_rejects_a_missing_openai_api_key(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            response = TestClient(server.app).get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(),
            {
                "status": "not_ready",
                "service": "cloudplot-agent",
                "missing": ["OPENAI_API_KEY"],
            },
        )

    def test_ag_ui_endpoint_is_registered_at_root(self):
        route_paths = {route.path for route in server.app.routes}
        self.assertIn("/", route_paths)

    def test_durable_persistence_request_fails_loudly(self):
        with (
            patch.dict(os.environ, {"CLOUDPLOT_REQUIRE_DURABLE_THREADS": "1"}),
            self.assertRaisesRegex(RuntimeError, "external checkpointer"),
        ):
            server.assert_supported_persistence()


if __name__ == "__main__":
    unittest.main()
