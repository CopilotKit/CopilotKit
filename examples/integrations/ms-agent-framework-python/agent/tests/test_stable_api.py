from __future__ import annotations

import os
import sys
import unittest
from importlib.metadata import version
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent_framework import SupportsChatGetResponse
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import AgentFrameworkAgent

from agent import create_agent


class StableApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True):
            from main import _build_chat_client

        cls.build_chat_client = staticmethod(_build_chat_client)

    def test_starter_uses_stable_agent_framework(self) -> None:
        self.assertRegex(version("agent-framework-ag-ui"), r"^\d+\.\d+\.\d+$")
        self.assertRegex(version("agent-framework-openai"), r"^\d+\.\d+\.\d+$")
        agent = create_agent(OpenAIChatClient(model="gpt-4o-mini", api_key="test-key"))
        self.assertIsInstance(agent, AgentFrameworkAgent)

        server_tool_names = {
            registered_tool.name
            for registered_tool in agent.agent.default_options["tools"]
        }
        self.assertEqual(server_tool_names, {"get_weather", "update_proverbs"})
        self.assertNotIn("go_to_moon", server_tool_names)

    def test_builds_openai_and_azure_clients(self) -> None:
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_CHAT_MODEL_ID": "gpt-4o-mini"},
            clear=True,
        ):
            openai_client = self.build_chat_client()

        with patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_API_KEY": "test-key",
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME": "gpt-4o-mini",
            },
            clear=True,
        ):
            azure_client = self.build_chat_client()

        self.assertIsInstance(openai_client, SupportsChatGetResponse)
        self.assertIsInstance(azure_client, SupportsChatGetResponse)
        self.assertIsInstance(openai_client, OpenAIChatClient)
        self.assertIsInstance(azure_client, OpenAIChatClient)


if __name__ == "__main__":
    unittest.main()
