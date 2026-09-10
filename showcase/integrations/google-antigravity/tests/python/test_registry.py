"""The registry, the Next routes and the manifest must agree on agent names."""

import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

EXPECTED_PATHS = {
    "agentic_chat",
    "prebuilt-sidebar",
    "prebuilt-popup",
    "chat-slots",
    "chat-customization-css",
    "headless-simple",
    "headless_complete",
    "beautiful_chat",
    "voice",
    "frontend_tools",
    "threadid-frontend-tool-roundtrip",
    "frontend-tools-async",
    "hitl-in-chat",
    "hitl-in-app",
    "gen-ui-tool-based",
    "tool-rendering",
    "tool-rendering-default-catchall",
    "tool-rendering-custom-catchall",
    "auth",
    "subagents",
    "reasoning-default",
    "reasoning-custom",
    "tool-rendering-reasoning-chain",
    "mcp-apps",
    "default",
}


def test_registry_module_lists_every_backend_path():
    source = (ROOT / "src/agents/registry.py").read_text()
    keys = set(re.findall(r'^\s+"([^"]+)":', source, flags=re.M))
    assert keys == EXPECTED_PATHS


def test_routes_only_reference_registered_paths():
    referenced = set()
    for route in (ROOT / "src/app/api").rglob("route.ts"):
        text = route.read_text()
        referenced |= set(re.findall(r"\$\{AGENT_URL\}/([A-Za-z0-9_-]+)", text))
        referenced |= set(re.findall(r'^\s+"([A-Za-z0-9_-]+)",\s*$', text, flags=re.M))
    assert referenced - EXPECTED_PATHS == set(), referenced - EXPECTED_PATHS


def test_manifest_features_are_routed():
    manifest = yaml.safe_load((ROOT / "manifest.yaml").read_text())
    shipped = [d for d in manifest["demos"] if d.get("route")]
    assert shipped, "manifest has no routed demos"
