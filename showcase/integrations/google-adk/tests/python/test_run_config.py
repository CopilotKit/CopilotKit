"""Tests for max_llm_calls configuration.

Validates that:
1. MAX_LLM_CALLS constant exists in shared_chat with a reasonable value
2. AgentSpec dataclass in registry.py has a max_llm_calls field
3. No agent in AGENT_REGISTRY overrides max_llm_calls above 25

All tests parse source text instead of importing modules, because the
ag_ui_adk dependency (transitively imported by shared_chat.py and
registry.py) requires Python >= 3.10 and the local environment may
be 3.9. Same approach as test_agent_id_alignment.py.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]  # showcase/integrations/google-adk
SHARED_CHAT_PATH = REPO_ROOT / "src" / "agents" / "shared_chat.py"
REGISTRY_PATH = REPO_ROOT / "src" / "agents" / "registry.py"


def _parse_int_constant(source: str, name: str) -> int:
    """Extract an integer constant assignment from Python source."""
    match = re.search(rf"^{name}\s*=\s*(\d+)", source, re.M)
    assert match, f"{name} not found in shared_chat.py"
    return int(match.group(1))


def test_max_llm_calls_constant_exists():
    text = SHARED_CHAT_PATH.read_text(encoding="utf-8")
    value = _parse_int_constant(text, "MAX_LLM_CALLS")
    assert 5 <= value <= 20, f"MAX_LLM_CALLS={value}, expected 5..20"


def test_agent_spec_has_max_llm_calls_field():
    """Parse the AgentSpec dataclass source for the max_llm_calls field."""
    text = REGISTRY_PATH.read_text(encoding="utf-8")
    assert re.search(
        r"^\s+max_llm_calls\s*:", text, re.M
    ), "AgentSpec must have a max_llm_calls field"


def test_all_agents_have_reasonable_max_llm_calls():
    """Verify no agent in AGENT_REGISTRY overrides max_llm_calls above 25.

    Parses registry source for explicit max_llm_calls=<int> arguments
    in AgentSpec(...) constructor calls. Any explicit value must be <= 25.
    Agents without an explicit override use MAX_LLM_CALLS (15), which is
    already validated by test_max_llm_calls_constant_exists.
    """
    text = REGISTRY_PATH.read_text(encoding="utf-8")
    explicit_values = re.findall(r"max_llm_calls\s*=\s*(\d+)", text)
    for val_str in explicit_values:
        val = int(val_str)
        assert val <= 25, (
            f"Found max_llm_calls={val} in registry.py, expected <= 25"
        )
