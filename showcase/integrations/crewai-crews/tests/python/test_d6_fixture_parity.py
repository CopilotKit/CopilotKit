"""Keep CrewAI deterministic D6 fixtures aligned with the LGP north star."""

import json
from pathlib import Path

import yaml


SHOWCASE_ROOT = Path(__file__).resolve().parents[4]
AIMOCK_ROOT = SHOWCASE_ROOT / "aimock" / "d6"
CREWAI_ROOT = SHOWCASE_ROOT / "integrations" / "crewai-crews"
DOCS_ROOT = SHOWCASE_ROOT / "shell-docs" / "src" / "content" / "docs"
CREWAI_DOCS_ROOT = DOCS_ROOT / "integrations" / "crewai-flows"
PARITY_FIXTURES = [
    "beautiful-chat.json",
    "gen-ui-a2ui-fixed.json",
    "gen-ui-custom.json",
    "gen-ui-headless-complete.json",
    "headless-complete.json",
    "shared-state-streaming.json",
    "tool-rendering.json",
    "tool-rendering-custom-catchall.json",
    "tool-rendering-default-catchall.json",
]

CREWAI_FIXTURES = AIMOCK_ROOT / "crewai-crews"
CREWAI_D4_FIXTURES = SHOWCASE_ROOT / "aimock" / "d4" / "crewai-crews"


def _normalized(path: Path) -> list[dict]:
    fixtures = json.loads(path.read_text())["fixtures"]
    for fixture in fixtures:
        fixture.get("match", {}).pop("context", None)
    return fixtures


def _docs_path_exists(shell_path: str) -> bool:
    relative = shell_path.removeprefix("/")
    candidates = [
        CREWAI_DOCS_ROOT / f"{relative}.mdx",
        CREWAI_DOCS_ROOT / relative / "index.mdx",
        DOCS_ROOT / f"{relative}.mdx",
        DOCS_ROOT / relative / "index.mdx",
    ]
    return any(candidate.exists() for candidate in candidates)


def test_crewai_docs_links_cover_every_manifest_capability():
    manifest = yaml.safe_load((CREWAI_ROOT / "manifest.yaml").read_text())
    docs_links = json.loads((CREWAI_ROOT / "docs-links.json").read_text())
    features = docs_links["features"]

    assert set(features) == set(manifest["features"])
    for feature_id, links in features.items():
        assert links.get("og_docs_url"), feature_id
        shell_path = links.get("shell_docs_path")
        assert shell_path and shell_path.startswith("/"), feature_id
        assert _docs_path_exists(shell_path), f"{feature_id}: {shell_path}"


def test_crewai_d6_behavioral_fixtures_match_langgraph_python():
    for filename in PARITY_FIXTURES:
        crewai = AIMOCK_ROOT / "crewai-crews" / filename
        langgraph = AIMOCK_ROOT / "langgraph-python" / filename
        assert crewai.exists(), f"missing CrewAI fixture: {filename}"
        assert _normalized(crewai) == _normalized(langgraph), filename


def test_crewai_frontend_tool_followups_cannot_be_shadowed_by_turn_zero():
    payload = json.loads((CREWAI_FIXTURES / "frontend-tools-async.json").read_text())
    planning = [
        fixture
        for fixture in payload["fixtures"]
        if "project planning" in fixture.get("match", {}).get("userMessage", "")
    ]

    assert any(
        fixture["match"].get("toolCallId") == "call_d5_query_notes_project_planning_001"
        for fixture in planning
    )
    assert all("turnIndex" not in fixture["match"] for fixture in planning)


def test_crewai_open_gen_ui_emitters_yield_to_tool_result_followups():
    payload = json.loads((CREWAI_FIXTURES / "gen-ui-tool-based.json").read_text())
    prompts = {
        "3D axis visualization (model airplane)",
        "Inline expression evaluator",
    }

    for prompt in prompts:
        matches = [
            fixture["match"]
            for fixture in payload["fixtures"]
            if fixture.get("match", {}).get("userMessage") == prompt
        ]
        assert any(match.get("toolCallId") for match in matches)
        emitters = [match for match in matches if not match.get("toolCallId")]
        assert emitters
        assert all(match.get("hasToolResult") is False for match in emitters)
        assert all("turnIndex" not in match for match in emitters)


def test_crewai_gen_ui_agent_emitters_outrank_broad_chat_fixtures():
    payload = json.loads((CREWAI_FIXTURES / "gen-ui-agent.json").read_text())
    prompts = {
        "Plan a product launch",
        "team offsite",
        "Research our top competitor",
    }

    emitters = [
        fixture["match"]
        for fixture in payload["fixtures"]
        if fixture.get("match", {}).get("userMessage") in prompts
    ]
    assert len(emitters) == len(prompts)
    assert all(match.get("hasToolResult") is False for match in emitters)


def test_crewai_reasoning_chain_emitters_outrank_generic_tool_fixtures():
    payload = json.loads(
        (CREWAI_FIXTURES / "tool-rendering-reasoning-chain.json").read_text()
    )
    prompts = {
        "Compare AAPL and MSFT stocks",
        "compare it to a smaller one",
        "show me the weather there",
    }

    emitters = [
        fixture["match"]
        for fixture in payload["fixtures"]
        if fixture.get("match", {}).get("userMessage") in prompts
        and not fixture.get("match", {}).get("toolCallId")
    ]
    assert len(emitters) == len(prompts)
    assert all(match.get("hasToolResult") is False for match in emitters)


def test_crewai_legacy_chat_fixtures_do_not_shadow_d6_specific_prompts():
    """AIMock is first-match-wins, so broad D4 substrings can steal D6 turns."""
    payload = json.loads((CREWAI_D4_FIXTURES / "chat.json").read_text())
    matchers = {
        fixture.get("match", {}).get("userMessage") for fixture in payload["fixtures"]
    }

    assert "summarize" not in matchers
    assert "Roll a 20-sided die" not in matchers
    assert "flights from SFO to JFK" not in matchers
    assert "weather" not in matchers
    assert "summarize my current sales pipeline" in matchers
    assert "Roll a 20-sided die for me." in matchers
    assert "_d4_unused_flights_probe_sfo_jfk" in matchers
    assert "_d4_unused_weather_probe_sf" in matchers
    assert "can you tell me what is in this demo image I just attached" not in matchers
    assert "can you tell me what is in this demo pdf I just attached" not in matchers
