import unittest

from ag_ui_adk import AGUIToolset
from google.adk.tools.agent_tool import AgentTool

import main
from main import market_agent, search_agent


class MarketAgentTopologyTest(unittest.TestCase):
    def test_root_agent_has_only_search_delegation_and_client_tools(self):
        delegated = [
            tool for tool in market_agent.tools if isinstance(tool, AgentTool)
        ]
        client_toolsets = [
            tool for tool in market_agent.tools if isinstance(tool, AGUIToolset)
        ]

        self.assertEqual(len(delegated), 1)
        self.assertIs(delegated[0].agent, search_agent)
        self.assertEqual(len(client_toolsets), 1)
        self.assertEqual(len(market_agent.tools), 2)

    def test_search_agent_owns_google_search(self):
        self.assertEqual(search_agent.name, "SearchAgent")
        self.assertEqual(len(search_agent.tools), 1)

    def test_agents_use_gemini_3_7_flash(self):
        self.assertEqual(search_agent.model, "gemini-3.7-flash")
        self.assertEqual(market_agent.model, "gemini-3.7-flash")

    def test_stock_starter_demos_are_not_copied(self):
        self.assertFalse(hasattr(main, "get_weather"))
        self.assertFalse(hasattr(main, "set_proverbs"))
        self.assertFalse(hasattr(main, "stage_search_result"))
        self.assertNotIn("MarketSnapshot", market_agent.instruction)


if __name__ == "__main__":
    unittest.main()
