"""Keep CrewAI deterministic D6 fixtures aligned with the LGP north star."""

import json
from pathlib import Path


SHOWCASE_ROOT = Path(__file__).resolve().parents[4]
AIMOCK_ROOT = SHOWCASE_ROOT / "aimock" / "d6"
PARITY_FIXTURES = [
    "beautiful-chat.json",
    "frontend-tools-async.json",
    "gen-ui-agent.json",
    "gen-ui-a2ui-fixed.json",
    "gen-ui-custom.json",
    "gen-ui-headless-complete.json",
    "headless-complete.json",
    "shared-state-streaming.json",
    "tool-rendering.json",
    "tool-rendering-custom-catchall.json",
    "tool-rendering-default-catchall.json",
    "tool-rendering-reasoning-chain.json",
]


def _normalized(path: Path) -> list[dict]:
    fixtures = json.loads(path.read_text())["fixtures"]
    for fixture in fixtures:
        fixture.get("match", {}).pop("context", None)
    return fixtures


def test_crewai_d6_behavioral_fixtures_match_langgraph_python():
    for filename in PARITY_FIXTURES:
        crewai = AIMOCK_ROOT / "crewai-crews" / filename
        langgraph = AIMOCK_ROOT / "langgraph-python" / filename
        assert crewai.exists(), f"missing CrewAI fixture: {filename}"
        assert _normalized(crewai) == _normalized(langgraph), filename
