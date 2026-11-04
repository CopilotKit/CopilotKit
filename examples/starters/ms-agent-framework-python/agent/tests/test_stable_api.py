from __future__ import annotations

import os
import sys
import unittest
from importlib.metadata import version
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent_framework import SupportsChatGetResponse
from agent_framework.openai import OpenAIChatClient, OpenAIChatCompletionClient
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

    def test_builds_keyless_azure_client_with_default_credential(self) -> None:
        credential = object()
        with (
            patch(
                "main.DefaultAzureCredential", return_value=credential
            ) as credential_cls,
            patch("main.OpenAIChatClient") as client_cls,
            patch.dict(
                os.environ,
                {
                    "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                    "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME": "gpt-4o-mini",
                },
                clear=True,
            ),
        ):
            self.build_chat_client()

        credential_cls.assert_called_once_with()
        client_cls.assert_called_once_with(
            model="gpt-4o-mini",
            api_key=None,
            credential=credential,
            azure_endpoint="https://example.openai.azure.com",
        )

    def test_agent_model_selects_provider_and_model(self) -> None:
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "test-key",
                "COPILOTKIT_AGENT_MODEL": "openai:gpt-4.1",
            },
            clear=True,
        ):
            openai_client = self.build_chat_client()
        self.assertIsInstance(openai_client, OpenAIChatClient)
        self.assertEqual(openai_client.model, "gpt-4.1")

        for spec, model, key_variable, base_url in (
            (
                "anthropic:claude-sonnet-4-5",
                "claude-sonnet-4-5",
                "ANTHROPIC_API_KEY",
                "https://api.anthropic.com/v1/",
            ),
            (
                "gemini/gemini-2.5-flash",
                "gemini-2.5-flash",
                "GOOGLE_API_KEY",
                "https://generativelanguage.googleapis.com/v1beta/openai/",
            ),
        ):
            with (
                patch("main.OpenAIChatCompletionClient") as client_cls,
                patch.dict(
                    os.environ,
                    {key_variable: "test-key", "COPILOTKIT_AGENT_MODEL": spec},
                    clear=True,
                ),
            ):
                self.build_chat_client()
            client_cls.assert_called_once_with(
                model=model,
                api_key="test-key",
                base_url=base_url,
            )

    def test_blank_agent_model_means_unset(self) -> None:
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "COPILOTKIT_AGENT_MODEL": "   "},
            clear=True,
        ):
            client = self.build_chat_client()
        self.assertIsInstance(client, OpenAIChatClient)
        self.assertEqual(client.model, "gpt-4o-mini")

    def test_agent_model_requires_the_provider_key(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "OPENAI_API_KEY": "test-key",
                    "COPILOTKIT_AGENT_MODEL": "anthropic:claude-sonnet-4-5",
                },
                clear=True,
            ),
            self.assertRaisesRegex(ValueError, "Set ANTHROPIC_API_KEY"),
        ):
            self.build_chat_client()

    def test_agent_model_rejects_unknown_provider(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "OPENAI_API_KEY": "test-key",
                    "COPILOTKIT_AGENT_MODEL": "mistral:large",
                },
                clear=True,
            ),
            self.assertRaisesRegex(ValueError, "COPILOTKIT_AGENT_MODEL"),
        ):
            self.build_chat_client()

    def test_azure_endpoint_takes_precedence_over_agent_model(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_API_KEY": "test-key",
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                "COPILOTKIT_AGENT_MODEL": "anthropic:claude-sonnet-4-5",
            },
            clear=True,
        ):
            client = self.build_chat_client()
        self.assertIsInstance(client, OpenAIChatClient)

    def test_compatible_base_url_uses_chat_completions(self) -> None:
        cases = (
            (None, OpenAIChatClient),
            ("https://openrouter.ai/api/v1", OpenAIChatCompletionClient),
            ("https://api.openai.com/v1", OpenAIChatClient),
            ("https://eu.api.openai.com/v1", OpenAIChatClient),
            ("https://myres.openai.azure.com/openai/v1", OpenAIChatClient),
            ("not a url", OpenAIChatClient),
        )
        for agent_model in (None, "openai:meta-llama/llama-3.3-70b"):
            for base_url, expected in cases:
                env = {"OPENAI_API_KEY": "test-key"}
                if base_url:
                    env["OPENAI_BASE_URL"] = base_url
                if agent_model:
                    env["COPILOTKIT_AGENT_MODEL"] = agent_model
                with self.subTest(base_url=base_url, agent_model=agent_model):
                    with patch.dict(os.environ, env, clear=True):
                        client = self.build_chat_client()
                    self.assertIs(type(client), expected)

    def test_missing_credentials_has_actionable_error(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            self.assertRaisesRegex(
                ValueError,
                "Set AZURE_OPENAI_ENDPOINT .* or OPENAI_API_KEY",
            ),
        ):
            self.build_chat_client()


if __name__ == "__main__":
    unittest.main()
