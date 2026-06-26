"""Dedicated Strands agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same auto-injected dynamic-schema A2UI setup as `a2ui_dynamic.py`
(declarative-gen-ui), but with the toolkit's validate->retry recovery loop made
*visible*. The two aimock pills drive the inner `render_a2ui` sub-agent two
ways:

  - HEAL pill: the model emits FREE-FORM / sloppy A2UI args (components and data
    as JSON strings rather than structured arrays) — the toolkit heals them via
    `parse_and_fix` into a valid surface in a single pass, which paints.
  - EXHAUST pill: every attempt is structurally invalid (the root references a
    missing child), so the validate->retry loop hits the cap and the tool
    returns the `a2ui_recovery_exhausted` hard-fail envelope, which the renderer
    surfaces as a tasteful `failed` state (no broken surface).

Wiring: unlike the langgraph/ADK siblings (which own `generate_a2ui` explicitly
via `get_a2ui_tools` + `injectA2UITool: false`), the Strands adapter runs the
recovery loop on its AUTO-INJECT path — when the runtime forwards
`injectA2UITool: true` (the page's provider catalog defaults it on), the adapter
auto-injects `generate_a2ui`, drives the `render_a2ui` sub-agent, and runs the
toolkit recovery loop + recovery-exhausted hard-fail itself. So this agent wires
NO tool; it is a clone of `build_a2ui_dynamic_agent` under a dedicated name.
Mirrors the ag-ui dojo `aws-strands` recovery example.

Catalog is reused from declarative-gen-ui ("declarative-gen-ui-catalog"); the
Vantage Threads sales dataset + composition rules arrive both from the frontend
App Context (the primary agent) and the `composition_guide` below (the inner
render planner).
"""

from __future__ import annotations

from strands import Agent
from ag_ui_strands import StrandsAgent, StrandsAgentConfig

from agents.agent import _build_model
from agents.a2ui_dynamic import CATALOG_ID, COMPOSITION_GUIDE, SYSTEM_PROMPT


def build_a2ui_recovery_agent() -> StrandsAgent:
    """Construct the dedicated A2UI recovery StrandsAgent.

    The `generate_a2ui` tool is auto-injected by the adapter when the runtime
    forwards `injectA2UITool: true`; the adapter also runs the toolkit
    validate->retry recovery loop (default 3 attempts) on that path. Nothing is
    wired into the Strands agent's `tools` list here.
    """
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
    )

    return StrandsAgent(
        agent=strands_agent,
        name="a2ui_recovery",
        description="Dynamic A2UI with automatic error recovery (auto-injected tool)",
        config=StrandsAgentConfig(
            a2ui={
                "default_catalog_id": CATALOG_ID,
                "guidelines": {"composition_guide": COMPOSITION_GUIDE},
            }
        ),
    )
