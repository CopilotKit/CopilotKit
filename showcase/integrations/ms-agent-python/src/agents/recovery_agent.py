"""MS Agent Framework agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same native auto-injection setup as `a2ui_dynamic.py` (declarative-gen-ui), but
with the toolkit's validate->retry recovery loop made *visible*. The two aimock
pills drive the inner `render_a2ui` sub-agent two ways:

  - HEAL pill: the first render attempt is structurally invalid (the root
    references a missing child), so the validate->retry loop rejects it and
    retries; the second attempt is valid and paints (building -> retrying ->
    painted).
  - EXHAUST pill: every attempt is structurally invalid, so the loop hits the
    attempt cap and the tool returns the `a2ui_recovery_exhausted` hard-fail
    envelope, which the renderer (`@ag-ui/a2ui-middleware`) surfaces as a
    tasteful `failed` state (no broken surface).

Wiring: the agent binds NO A2UI tool of its own. The route sets
`injectA2UITool: true` and the `/a2ui_recovery` endpoint carries an `a2ui_config`
with the recovery cap + catalog (see `agent_server.py`), so the adapter's
`plan_a2ui_injection` auto-injects the native `generate_a2ui` sub-agent and runs
the shared toolkit's validate->retry recovery loop from that backend config.
This matches the other MAF A2UI demos and MAF's upstream recovery example
(`agent_framework_ag_ui_examples`), which drive recovery through `a2ui_config`
rather than an explicit `enable_a2ui()` wrap.
"""

from __future__ import annotations

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"

# The recovery cap + catalog live in the endpoint `a2ui_config` (agent_server.py),
# consumed by auto-injection — not on the agent. Keep this exported so the server
# and the config stay in sync.
A2UI_RECOVERY_CONFIG = {
    # `maxAttempts` pins the renderer's "Retrying… (N/M)" label to the adapter's cap.
    "recovery": {"maxAttempts": 3},
    "default_catalog_id": CUSTOM_CATALOG_ID,
}

# Keep this aligned with the declarative-gen-ui SYSTEM_PROMPT: a demo assistant
# that answers every question by drawing a surface. `generate_a2ui` (auto-injected
# by the adapter) handles the rendering — and its automatic recovery — internally.
SYSTEM_PROMPT = (
    "You are a demo assistant for A2UI Error Recovery. Whenever a response "
    "would benefit from a rich visual — a dashboard, KPI summary, status "
    "report, or card layout — call `generate_a2ui` to draw it. The registered "
    "catalog includes `Card`, `StatusBadge`, `Metric`, `InfoRow`, "
    "`PrimaryButton`, `PieChart`, and `BarChart` (in addition to the basic "
    "A2UI primitives). `generate_a2ui` takes no arguments and handles the "
    "rendering — and its automatic recovery from a malformed first attempt — "
    "for you. Keep chat replies to one short sentence; let the UI do the "
    "talking."
)


def create_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed A2UI error-recovery agent.

    The agent binds no A2UI tool: the route forwards `injectA2UITool: true` and
    the endpoint's `a2ui_config` (`A2UI_RECOVERY_CONFIG`) carries the recovery cap
    + catalog, so the adapter auto-injects `generate_a2ui` and runs the recovery
    loop. `chat_client` is a Chat-Completions client (`OpenAIChatCompletionClient`),
    reused as the render sub-agent so its `render_a2ui` arguments stream progressively.
    """
    base_agent = Agent(
        client=chat_client,
        name="a2ui_recovery_agent",
        instructions=SYSTEM_PROMPT,
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description=(
            "A2UI generator with the validate->retry recovery loop made visible."
        ),
        require_confirmation=False,
    )
