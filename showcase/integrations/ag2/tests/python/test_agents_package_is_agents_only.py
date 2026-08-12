"""src/agents/ must contain agents, not harness plumbing."""
from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parents[2] / "src" / "agents"

BANNED = {"_header_forwarding.py", "_cvdiag_backend.py"}


def test_no_harness_shims_in_agents_package():
    present = {p.name for p in AGENTS_DIR.glob("*.py")} & BANNED
    assert not present, f"harness plumbing still in agents/: {sorted(present)}"
