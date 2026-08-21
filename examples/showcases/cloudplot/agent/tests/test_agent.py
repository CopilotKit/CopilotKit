from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import END

import main


def base_state(**overrides):
    state = {
        "messages": [HumanMessage(content="Design the architecture")],
        "nodes": [],
        "edges": [],
        "logs": [],
        "cost": 0.0,
        "status": "idle",
        "validation_errors": [],
        "copilotkit": {"actions": []},
    }
    state.update(overrides)
    return state


class FakeBoundModel:
    def __init__(self, response):
        self.response = response

    async def ainvoke(self, _messages, _config):
        return self.response


class FakeModel:
    def __init__(self, response):
        self.response = response
        self.bound_tools = []
        self.parallel_tool_calls = None

    def bind_tools(self, tools, *, parallel_tool_calls):
        self.bound_tools = tools
        self.parallel_tool_calls = parallel_tool_calls
        return FakeBoundModel(self.response)


class AgentBehaviorTests(unittest.IsolatedAsyncioTestCase):
    async def test_frontend_approval_tool_is_bound_and_returned_to_copilotkit(self):
        approval = {
            "name": "approveDeployment",
            "description": "Ask the operator to approve a simulated deployment",
            "parameters": {
                "type": "object",
                "properties": {"action": {"type": "string"}},
            },
        }
        response = AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "approveDeployment",
                    "args": {
                        "action": "Simulate deployment",
                        "resources": ["web-server"],
                        "cost_impact": "+$30/mo",
                        "risk_level": "medium",
                    },
                    "id": "approval-1",
                    "type": "tool_call",
                }
            ],
        )
        model = FakeModel(response)

        with patch.object(main, "create_architect_model", return_value=model):
            command = await main.architect_node(
                base_state(copilotkit={"actions": [approval]}), {}
            )

        bound_names = [
            tool.get("name") if isinstance(tool, dict) else tool.name
            for tool in model.bound_tools
        ]
        self.assertIn("approveDeployment", bound_names)
        self.assertEqual(command.goto, END)
        self.assertEqual(
            command.update["messages"][0].tool_calls[0]["name"], "approveDeployment"
        )

    def test_remove_tool_updates_real_state_and_incident_edges(self):
        state = base_state(
            nodes=[
                {"id": "alb-1", "type": "alb", "config": {}, "position": {}},
                {"id": "ec2-1", "type": "ec2", "config": {}, "position": {}},
                {"id": "rds-1", "type": "rds", "config": {}, "position": {}},
            ],
            edges=[
                {"id": "edge-1", "source": "alb-1", "target": "ec2-1"},
                {"id": "edge-2", "source": "ec2-1", "target": "rds-1"},
            ],
        )

        result = main.remove_resource.invoke({"resource_id": "ec2-1"})
        updated = main.apply_tool_result(state, result)

        self.assertEqual(
            [node["id"] for node in updated["nodes"]],
            ["alb-1", "rds-1"],
        )
        self.assertEqual(updated["edges"], [])

    async def test_connect_rejects_missing_endpoints_without_hiding_orphans(self):
        state = base_state(
            nodes=[
                {"id": "ec2-1", "type": "ec2", "config": {}, "position": {}},
            ],
        )

        for source_id, target_id in [
            ("missing-source", "ec2-1"),
            ("ec2-1", "missing-target"),
        ]:
            with self.subTest(source_id=source_id, target_id=target_id):
                result = main.connect_resources.invoke(
                    {"source_id": source_id, "target_id": target_id}
                )
                updated = main.apply_tool_result(state, result)

                self.assertEqual(updated["edges"], [])
                self.assertEqual(updated["logs"][-1]["type"], "warning")
                self.assertIn("does not exist", updated["logs"][-1]["message"])

                validation = await main.validate_node(
                    {**state, **updated},
                    {},
                )
                validation_messages = [
                    item["message"] for item in validation.update["validation_errors"]
                ]
                self.assertTrue(
                    any("EC2 ec2-1 is orphaned" in item for item in validation_messages)
                )

    def test_update_and_move_reject_missing_resources_with_warning(self):
        state = base_state(
            nodes=[
                {"id": "vpc-1", "type": "vpc", "config": {}, "position": {}},
                {"id": "ec2-1", "type": "ec2", "config": {}, "position": {}},
            ],
        )
        operations = [
            {
                "updated": "missing-resource",
                "config": {"size": "large"},
                "success": True,
            },
            {"moved": "missing-resource", "vpc_id": "vpc-1", "success": True},
        ]

        for result in operations:
            with self.subTest(result=result):
                updated = main.apply_tool_result(state, result)

                self.assertEqual(updated["nodes"], state["nodes"])
                self.assertEqual(updated["edges"], state["edges"])
                self.assertEqual(updated["logs"][-1]["type"], "warning")
                self.assertIn("does not exist", updated["logs"][-1]["message"])

    async def test_validation_and_cost_run_against_production_nodes(self):
        nodes = [
            {"id": "vpc-1", "type": "vpc", "config": {}, "position": {}},
            {
                "id": "public-bucket",
                "type": "s3",
                "config": {"access_level": "public"},
                "position": {},
            },
            {
                "id": "db-1",
                "type": "rds",
                "config": {"encryption": False, "instance_class": "db.t3.micro"},
                "position": {},
            },
            {
                "id": "compute-1",
                "type": "ec2",
                "config": {"instance_type": "t3.medium"},
                "position": {},
            },
            {
                "id": "lambda-1",
                "type": "lambda",
                "config": {"memory": 4096},
                "parentId": "missing-vpc",
                "position": {},
            },
            {"id": "alb-1", "type": "alb", "config": {}, "position": {}},
        ]
        state = base_state(nodes=nodes)

        validation = await main.validate_node(state, {})
        messages = [item["message"] for item in validation.update["validation_errors"]]
        self.assertTrue(any("publicly accessible" in message for message in messages))
        self.assertTrue(any("encryption disabled" in message for message in messages))
        self.assertTrue(any("orphaned" in message for message in messages))
        self.assertTrue(any("high memory" in message for message in messages))
        self.assertTrue(any("non-existent VPC" in message for message in messages))

        cost = await main.cost_estimator_node(state, {})
        self.assertEqual(cost.update["cost"], 61.71)
        self.assertEqual(cost.update["status"], "idle")

    def test_tool_results_accept_structured_or_valid_json_and_log_bad_json(self):
        payload = {"removed": "ec2-1", "success": True}
        self.assertEqual(main.parse_tool_result(payload), payload)
        self.assertEqual(main.parse_tool_result(json.dumps(payload)), payload)

        with self.assertLogs("cloudplot.agent", level="WARNING") as logs:
            self.assertIsNone(main.parse_tool_result("{'removed': 'ec2-1'}"))
        self.assertTrue(
            any("Could not parse tool result as JSON" in line for line in logs.output)
        )

    def test_model_configuration_has_no_sampling_or_truncation_override(self):
        with patch.object(main, "ChatOpenAI") as constructor:
            main.create_architect_model()

        kwargs = constructor.call_args.kwargs
        self.assertEqual(kwargs["model"], "gpt-5.1")
        self.assertNotIn("temperature", kwargs)
        self.assertNotIn("max_tokens", kwargs)

    def test_backend_tool_set_is_simulation_only_and_has_no_deploy_alias(self):
        self.assertEqual(
            [tool.name for tool in main.backend_tools],
            [
                "add_resource",
                "connect_resources",
                "remove_resource",
                "update_resource",
                "move_to_vpc",
            ],
        )


if __name__ == "__main__":
    unittest.main()
