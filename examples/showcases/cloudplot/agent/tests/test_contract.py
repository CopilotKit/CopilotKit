from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

FRONTEND_ROOT = Path(__file__).resolve().parents[2]
SOURCE_SHA = "519122234752ab9f85912bf873f4f11ccf68c5c6"
RESOURCE_TYPES = ["vpc", "alb", "ec2", "lambda", "rds", "s3"]
OPERATIONS = ["add", "connect", "update", "remove", "VPC-move"]


def _fixture() -> dict:
    return json.loads((FRONTEND_ROOT / "fixtures/cp-fixture.json").read_text())


def test_cp_fixture_digest_is_stable() -> None:
    fixture = _fixture()
    expected = fixture.pop("contract_digest_sha256")
    canonical = json.dumps(fixture, sort_keys=True, separators=(",", ":")).encode()

    assert hashlib.sha256(canonical).hexdigest() == expected


@pytest.mark.parametrize("resource_type", RESOURCE_TYPES)
@pytest.mark.parametrize("operation", OPERATIONS)
def test_cp_fixture_contains_evidenced_resource_operation_cell(
    resource_type: str,
    operation: str,
) -> None:
    cell = _fixture()["operation_matrix"][resource_type][operation]
    evidence = cell["evidence"]

    assert cell["disposition"] in {"applicable", "N/A-not-applicable-resource"}
    assert evidence == {
        **evidence,
        "source_repo": "https://github.com/markmdev/cloudplot",
        "source_sha": SOURCE_SHA,
    }
    assert evidence["source_path"]
    assert evidence["start_line"] <= evidence["end_line"]
    assert len(evidence["source_snippet_sha256"]) == 64


def test_cp_fixture_keeps_explicit_vpc_move_na_cells() -> None:
    matrix = _fixture()["operation_matrix"]

    for resource_type in ["vpc", "s3"]:
        assert matrix[resource_type]["VPC-move"]["applicable"] is False
        assert matrix[resource_type]["VPC-move"]["n_a_approval"]
    for resource_type in ["alb", "ec2", "lambda", "rds"]:
        assert matrix[resource_type]["VPC-move"]["applicable"] is True


def test_cp_fixture_pins_connections_cost_and_ordered_primary_state() -> None:
    fixture = _fixture()

    assert fixture["valid_connection_fixtures"] == [
        {"source_type": "alb", "target_type": "ec2"},
        {"source_type": "ec2", "target_type": "rds"},
        {"source_type": "lambda", "target_type": "s3"},
    ]
    assert fixture["deterministic_three_tier_cost"]["total"] == 59.21
    primary = fixture["deterministic_primary_fixture"]
    assert primary["initial_state"]["nodes"] == []
    assert [step["operation"] for step in primary["ordered_operations"]][-2:] == [
        "validate",
        "estimate_cost",
    ]
    assert primary["expected_state"]["status"] == "idle"


def test_cp_fixture_pins_validation_branch_and_approval_contracts() -> None:
    fixture = _fixture()

    assert [
        (item["code"], item["level"]) for item in fixture["validation_fixtures"]
    ] == [
        ("s3-public-access", "warning"),
        ("rds-encryption-disabled", "warning"),
        ("rds-orphaned", "warning"),
        ("compute-orphaned", "warning"),
        ("lambda-memory-too-high", "warning"),
        ("invalid-vpc-parent", "error"),
    ]
    assert [step["step"] for step in fixture["branch_fixture"]["steps"]] == [
        "create-A",
        "fork-B",
        "mutate-B",
        "switch-A",
        "switch-B",
        "reload-same-profile",
        "fresh-profile",
    ]
    assert fixture["approval"] == {
        "decisions": ["approved", "rejected"],
        "rejection_preserves_pre_action_state": True,
        "simulation_copy": "Simulation only — no AWS resources will be created.",
    }


def test_agent_health_contract_matches_the_langgraph_server_entrypoint() -> None:
    fixture = _fixture()
    agent_health = fixture["health"]["agent"]
    railway = (FRONTEND_ROOT / "agent/railway.toml").read_text()
    dockerfile = (FRONTEND_ROOT / "agent/Dockerfile").read_text()
    langgraph_config = json.loads((FRONTEND_ROOT / "agent/langgraph.json").read_text())

    assert agent_health == {
        "implementation": "LangGraph Agent Server built-in health endpoint",
        "entrypoint": "uv run langgraph dev --host 0.0.0.0 --port $PORT --no-browser",
        "route": "/ok",
        "response": {"ok": True},
    }
    assert 'healthcheckPath = "/ok"' in railway
    assert agent_health["entrypoint"] in dockerfile
    assert "http" not in langgraph_config


def test_agent_runtime_removes_incident_edges_and_settles_before_idle() -> None:
    main_py = (FRONTEND_ROOT / "agent/main.py").read_text()

    assert 'if e["source"] != resource_id and e["target"] != resource_id' in main_py
    assert 'goto="cost_estimator_node"' in main_py
    assert main_py.index('goto="cost_estimator_node"') < main_py.index(
        '"status": "idle"'
    )
