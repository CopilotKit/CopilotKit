#!/usr/bin/env python3
"""Auto-generate langgraph.json from the filesystem.

Demo folder is the source of truth. Drop an `agent.py` into
`src/app/demos/<id>/` and the graph is registered automatically under
graph_id `<id>` (with hyphens converted to underscores for Python
identifier compatibility).

Also picks up legacy shared agents from `src/agents/*.py` — those will
disappear as demos are migrated into folder-owned graphs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    graphs: dict[str, str] = {}

    # Legacy shared agents (pre-migration). These will disappear as demos
    # migrate into folder-owned graphs; until then we map each legacy file
    # to the graph ID the shared `api/copilotkit/route.ts` already uses.
    legacy_graph_id = {
        "main": "sample_agent",
        "tool_rendering_agent": "tool_rendering",
        "mcp_apps_agent": "mcp_apps",
        "open_gen_ui_agent": "open_gen_ui",
    }
    legacy_dir = PKG_ROOT / "src" / "agents"
    if legacy_dir.exists():
        for f in sorted(legacy_dir.glob("*.py")):
            if f.name == "__init__.py":
                continue
            graph_id = legacy_graph_id.get(f.stem, f.stem)
            graphs[graph_id] = f"./src/agents/{f.name}:graph"

    # Per-demo agents — the target layout.
    demos_dir = PKG_ROOT / "src" / "app" / "demos"
    if demos_dir.exists():
        for demo in sorted(p for p in demos_dir.iterdir() if p.is_dir()):
            agent_py = demo / "agent.py"
            if not agent_py.exists():
                continue
            graph_id = demo.name.replace("-", "_")
            if graph_id in graphs:
                # Per-demo wins over legacy on collision — new layout is
                # the source of truth once a demo is migrated.
                pass
            graphs[graph_id] = f"./src/app/demos/{demo.name}/agent.py:graph"

    out = {"dependencies": ["."], "graphs": graphs}
    (PKG_ROOT / "langgraph.json").write_text(
        json.dumps(out, indent=2) + "\n",
    )
    print(
        f"Generated langgraph.json with {len(graphs)} graphs: "
        f"{', '.join(sorted(graphs.keys()))}",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
