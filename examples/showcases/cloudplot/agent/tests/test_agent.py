from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.graph import END
from langgraph.runtime import Runtime

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
    def __init__(self, response, invocations):
        self.response = response
        self.invocations = invocations

    async def ainvoke(self, messages, _config):
        self.invocations.append(messages)
        return self.response


class FakeModel:
    def __init__(self, response):
        self.response = response
        self.bound_tools = []
        self.parallel_tool_calls = None
        self.invocations = []

    def bind_tools(self, tools, *, parallel_tool_calls):
        self.bound_tools = tools
        self.parallel_tool_calls = parallel_tool_calls
        return FakeBoundModel(self.response, self.invocations)


class AgentBehaviorTests(unittest.IsolatedAsyncioTestCase):
    async def test_tool_node_preserves_model_supplied_resource_config(self):
        tool_call = AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "add_resource",
                    "args": {
                        "resource_type": "ec2",
                        "name": "api",
                        "resource_config": {
                            "instance_type": "t3.large",
                            "ami": "ami-custom",
                        },
                    },
                    "id": "add-custom-ec2",
                    "type": "tool_call",
                }
            ],
        )

        command = await main.tool_node_wrapper(
            base_state(messages=[tool_call]),
            {"configurable": {"__pregel_runtime": Runtime()}},
        )

        node = command.update["nodes"][0]
        self.assertEqual(node["config"]["instance_type"], "t3.large")
        self.assertEqual(node["config"]["ami"], "ami-custom")
        self.assertEqual(command.update["cost"], 60.74)

    async def test_invalid_typed_update_returns_structured_error_without_mutation(self):
        state = base_state(
            nodes=[
                {
                    "id": "lambda-1",
                    "type": "lambda",
                    "config": {"runtime": "python3.12", "memory": 128, "timeout": 30},
                    "position": {},
                }
            ]
        )
        tool_call = AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "update_resource",
                    "args": {
                        "resource_id": "lambda-1",
                        "update": {
                            "resource_type": "lambda",
                            "memory": "4 GB",
                        },
                    },
                    "id": "invalid-lambda-update",
                    "type": "tool_call",
                }
            ],
        )

        command = await main.tool_node_wrapper(
            {**state, "messages": [tool_call]},
            {"configurable": {"__pregel_runtime": Runtime()}},
        )

        self.assertEqual(command.update["nodes"], state["nodes"])
        self.assertEqual(command.update["edges"], state["edges"])
        self.assertEqual(command.update["logs"][-1]["type"], "error")
        response = command.update["messages"][0].content
        self.assertIn('"success": false', response)
        self.assertIn("Invalid arguments for update_resource", response)

    async def test_update_rejects_a_resource_type_mismatch(self):
        state = base_state(
            nodes=[
                {
                    "id": "lambda-1",
                    "type": "lambda",
                    "config": {"runtime": "python3.12", "memory": 128, "timeout": 30},
                    "position": {},
                }
            ]
        )
        tool_call = AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "update_resource",
                    "args": {
                        "resource_id": "lambda-1",
                        "update": {
                            "resource_type": "ec2",
                            "instance_type": "t3.large",
                        },
                    },
                    "id": "mismatched-update",
                    "type": "tool_call",
                }
            ],
        )

        command = await main.tool_node_wrapper(
            {**state, "messages": [tool_call]},
            {"configurable": {"__pregel_runtime": Runtime()}},
        )

        self.assertEqual(command.update["nodes"], state["nodes"])
        response = command.update["messages"][0].content
        self.assertIn('"success": false', response)
        self.assertIn("resource type is lambda, not ec2", response)

    async def test_architect_prompt_marks_simulation_boundary_as_critical(self):
        model = FakeModel(AIMessage(content="Architecture ready"))

        with patch.object(main, "create_architect_model", return_value=model):
            await main.architect_node(base_state(), {})

        system_prompt = model.invocations[0][0].content
        self.assertIn("CRITICAL:", system_prompt)
        self.assertIn("simulation", system_prompt.lower())

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

    async def test_tool_wrapper_reports_rejected_mutations_as_failures(self):
        state = base_state(
            nodes=[
                {"id": "vpc-1", "type": "vpc", "config": {}, "position": {}},
                {"id": "ec2-1", "type": "ec2", "config": {}, "position": {}},
            ],
        )
        operations = [
            (
                "add_resource",
                {
                    "resource_type": "ec2",
                    "name": "orphaned-compute",
                    "vpc_id": "missing-vpc",
                },
            ),
            (
                "connect_resources",
                {"source_id": "ec2-1", "target_id": "missing-target"},
            ),
            (
                "update_resource",
                {
                    "resource_id": "missing-resource",
                    "update": {
                        "resource_type": "ec2",
                        "instance_type": "t3.large",
                    },
                },
            ),
            (
                "move_to_vpc",
                {"resource_id": "missing-resource", "vpc_id": "vpc-1"},
            ),
            (
                "move_to_vpc",
                {"resource_id": "ec2-1", "vpc_id": "missing-vpc"},
            ),
        ]

        for index, (tool_name, args) in enumerate(operations):
            with self.subTest(tool_name=tool_name):
                tool_call = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": tool_name,
                            "args": args,
                            "id": f"rejected-{index}",
                            "type": "tool_call",
                        }
                    ],
                )
                command = await main.tool_node_wrapper(
                    {**state, "messages": [tool_call]},
                    {"configurable": {"__pregel_runtime": Runtime()}},
                )

                self.assertEqual(command.update["nodes"], state["nodes"])
                self.assertEqual(command.update["edges"], state["edges"])
                response = command.update["messages"][0].content
                self.assertIn('"success": false', response)
                self.assertIn("does not exist", response)
                self.assertNotIn('"success": true', response)

    async def test_tool_wrapper_reports_malformed_results_as_failures(self):
        state = base_state(
            nodes=[
                {"id": "vpc-1", "type": "vpc", "config": {}, "position": {}},
            ],
        )

        class MalformedToolNode:
            def __init__(self, *, tools):
                self.tools = tools

            async def ainvoke(self, _state, _config):
                return {
                    "messages": [
                        ToolMessage(
                            content="{'created': 'ec2-1'}",
                            tool_call_id="malformed-1",
                            name="add_resource",
                        )
                    ]
                }

        with patch.object(main, "ToolNode", MalformedToolNode):
            command = await main.tool_node_wrapper(state, {})

        self.assertEqual(command.update["nodes"], state["nodes"])
        self.assertEqual(command.update["edges"], state["edges"])
        response = command.update["messages"][0].content
        self.assertIn('"success": false', response)
        self.assertIn("Malformed backend tool result", response)
        self.assertEqual(command.update["logs"][-1]["type"], "error")

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
