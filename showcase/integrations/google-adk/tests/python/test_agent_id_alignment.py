"""Regression test for agent-ID drift between frontend pages and the
registry / route.ts mount paths.

PR #4792 shipped with three drifts that all caused the same user-visible
"Application crashed" symptom:
- `/demos/hitl-in-chat` page passed `agent="hitl_in_chat"` (underscore)
  while the backend mounted `/hitl-in-chat` (dash).
- `/demos/frontend-tools-async`: `agent="frontend_tools_async"` vs
  backend `frontend-tools-async`.
- `/demos/prebuilt-popup`: `agent="prebuilt_popup"` vs backend
  `prebuilt-popup`.

The frontend's `useAgent(<id>)` calls `runtime.getInfo()` to resolve the
agent map, and if the requested name isn't in there it throws the
`Agent '<id>' not found after runtime sync. Known agents: [...]` error
that crashes the React tree.

This test parses every demo page.tsx, harvests the agent IDs it claims
(via `agent=`, `agentId=`, or `agentId:` in `useAgent`/`useHumanInTheLoop`
calls), and asserts every harvested ID is actually mounted by
`registry.AGENT_REGISTRY`. Doesn't catch routing through dedicated routes
like /api/copilotkit-mcp-apps, but the main /api/copilotkit list in
route.ts is checked separately below.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]  # showcase/integrations/google-adk
DEMOS_DIR = REPO_ROOT / "src" / "app" / "demos"
API_DIR = REPO_ROOT / "src" / "app" / "api"
REGISTRY_PATH = REPO_ROOT / "src" / "agents" / "registry.py"
MAIN_ROUTE_PATH = API_DIR / "copilotkit" / "route.ts"


def _registry_mounts() -> set[str]:
    """Return the agent NAMES mounted by `agents/registry.py:AGENT_REGISTRY`.

    Reads source directly so the test doesn't have to import google.adk —
    keeps it runnable without the full agent dependency stack.
    """
    text = REGISTRY_PATH.read_text(encoding="utf-8")
    return set(
        re.findall(r'^\s+["\']([a-zA-Z0-9_-]+)["\']\s*:\s*AgentSpec', text, re.M)
    )


def _all_runtime_agent_ids() -> set[str]:
    """Return the union of every agent ID exposed by any route.ts.

    Each demo can target a different runtime endpoint via `runtimeUrl`
    (the main `/api/copilotkit` plus dedicated endpoints like
    `/api/copilotkit-declarative-gen-ui`). Each route.ts declares its
    own `agents: {...}` map (or `agentNames` array). We union them so
    a demo's claimed agent ID just needs to appear in at least one
    map. This matches what `useAgent` actually sees through the
    runtime's `/info` endpoint, which is per-runtime.
    """
    ids: set[str] = set()
    # 1) main route.ts: const agentNames = [ "a", "b", ... ]
    if MAIN_ROUTE_PATH.exists():
        text = MAIN_ROUTE_PATH.read_text(encoding="utf-8")
        m = re.search(r"const\s+agentNames\s*=\s*\[(.*?)\]", text, re.S)
        if m:
            ids.update(re.findall(r'["\']([a-zA-Z0-9_-]+)["\']', m.group(1)))
    # 2) dedicated routes: harvest from BOTH the object form
    #    (`agents: { "name": new HttpAgent(...) }`) and the array form
    #    (`agents: ["name-a", "name-b"]` — used inside `openGenerativeUI`).
    #    The previous "balance braces" regex broke when an HttpAgent
    #    constructor wrapped its `url:` template across lines, swallowing
    #    the nested `{` and skipping the keys. Two simpler passes:
    #      (a) capture `agents: {` → next `},` block and pull out
    #          `"name":` keys.
    #      (b) capture `agents: [ ... ]` and pull out the quoted strings.
    for route in API_DIR.rglob("route.ts"):
        text = route.read_text(encoding="utf-8")
        # (a) object-form agents map. Two declaration shapes:
        #     `agents: { ... }` (passed inline to `new CopilotRuntime(...)`)
        #     `const agents: Record<string, ...> = { ... }` (top-level)
        for block in re.finditer(
            r"agents(?:\s*:\s*[^=]+=\s*|\s*:\s*)\{(.+?)\}\s*[,;\n]",
            text,
            re.DOTALL,
        ):
            ids.update(re.findall(r'["\']([a-zA-Z0-9_-]+)["\']\s*:', block.group(1)))
        # (b) array-form agents list (e.g. openGenerativeUI.agents).
        for block in re.finditer(r"agents\s*:\s*\[([^\]]*)\]", text):
            ids.update(re.findall(r'["\']([a-zA-Z0-9_-]+)["\']', block.group(1)))
    return ids


def _harvest_page_agents() -> dict[str, set[str]]:
    """Parse each demo page.tsx and harvest the agent IDs it claims."""
    pattern = re.compile(r"""(?:agent|agentId)\s*[=:]\s*["']([a-zA-Z0-9_-]+)["']""")
    out: dict[str, set[str]] = {}
    for demo in sorted(DEMOS_DIR.iterdir()):
        if not demo.is_dir() or demo.name.startswith("_"):
            continue
        page = demo / "page.tsx"
        if not page.exists():
            continue
        ids = set(pattern.findall(page.read_text(encoding="utf-8")))
        if ids:
            out[demo.name] = ids
    return out


def test_registry_mounts_at_least_one_agent():
    mounts = _registry_mounts()
    assert mounts, "registry.AGENT_REGISTRY appears empty — parser bug?"


def test_every_demo_page_agent_id_is_exposed_by_some_route():
    """For each demo's page.tsx, every agent ID it claims via
    `agent=...` / `agentId=...` MUST appear in the agents map of at
    least one route.ts (the main `/api/copilotkit` or a dedicated
    runtime endpoint).

    A mismatch here is the exact root cause of the
    `useAgent: Agent '<id>' not found after runtime sync` crash. Demos
    target different runtime endpoints via `runtimeUrl`, so we union
    every route's agents map and verify membership against that — not
    against the AGENT_REGISTRY directly (which is the BACKEND mount
    table, not the frontend-visible agent map).
    """
    exposed = _all_runtime_agent_ids()
    per_page = _harvest_page_agents()
    bad: list[tuple[str, str]] = []
    for demo_name, ids in per_page.items():
        for agent_id in ids:
            if agent_id not in exposed:
                bad.append((demo_name, agent_id))
    assert not bad, (
        "Agent-ID drift between demo page.tsx and runtime agent maps:\n"
        + "\n".join(
            f"  - /demos/{d} requests agent={a!r} but it's not exposed by "
            f"any route.ts agents map (or main agentNames list)."
            for d, a in bad
        )
        + f"\nUnion of exposed IDs across all routes: {sorted(exposed)}"
    )


def test_main_route_agent_map_aligns_with_registry():
    """`src/app/api/copilotkit/route.ts` has an `agentNames` list that
    must be a subset of `registry.AGENT_REGISTRY` — every name in the
    list is bound to an `HttpAgent({ url: \\`${AGENT_URL}/${name}\\` })`,
    and the backend FastAPI will 404 on any name that isn't mounted.
    """
    mounts = _registry_mounts()
    text = MAIN_ROUTE_PATH.read_text(encoding="utf-8")
    # The agentNames list looks like: `const agentNames = [ "a", "b", ... ];`
    list_match = re.search(r"const\s+agentNames\s*=\s*\[(.*?)\]", text, re.S)
    assert list_match, "Could not locate agentNames array in route.ts"
    names = re.findall(r'["\']([a-zA-Z0-9_-]+)["\']', list_match.group(1))
    assert names, "agentNames array parsed but contained zero string entries"
    missing = [n for n in names if n not in mounts]
    assert not missing, (
        f"route.ts main agentNames list contains entries not mounted by "
        f"registry: {missing}. Either add them to AGENT_REGISTRY or drop "
        f"them from route.ts."
    )


def test_known_renamed_demos_use_dashed_ids():
    """Pin the specific renames from PR #4792 so future refactors don't
    silently revert them: hitl-in-chat, frontend-tools-async,
    prebuilt-popup must use dash form on the frontend (matching backend
    registry keys), not underscore."""
    per_page = _harvest_page_agents()
    expectations = {
        "hitl-in-chat": "hitl-in-chat",
        "frontend-tools-async": "frontend-tools-async",
        "prebuilt-popup": "prebuilt-popup",
    }
    for demo, expected in expectations.items():
        ids = per_page.get(demo, set())
        assert expected in ids, (
            f"/demos/{demo}/page.tsx no longer declares agent={expected!r}. "
            f"Found IDs: {sorted(ids)}. The dash form is required to match "
            f"the backend mount in registry.AGENT_REGISTRY."
        )
        # And the underscore variants MUST NOT be present.
        underscore = expected.replace("-", "_")
        assert underscore not in ids, (
            f"/demos/{demo}/page.tsx has reverted to the underscore "
            f"agent ID {underscore!r}. PR #4792's rename fix prevents "
            f"the `useAgent: Agent not found` crash; this regressed it."
        )
