"""MS Agent Framework agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as `a2ui_dynamic.py` (declarative-gen-ui), but
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

Backend-owned wiring (mirrors the LangGraph reference
`showcase/integrations/langgraph-python/src/agents/recovery_agent.py`): unlike
the declarative-gen-ui demo (whose hand-rolled `generate_a2ui` tool has no
recovery loop), this agent uses the Microsoft Agent Framework adapter's native
`enable_a2ui`, whose `generate_a2ui` runs the `render_a2ui` sub-agent + the
shared toolkit recovery loop in-process. The dedicated route sets
`injectA2UITool: false` so the runtime does not inject a second copy; the
provider catalog still reaches the sub-agent via App Context. Only this
backend-owned path surfaces the recovery loop + `a2ui_recovery_exhausted`
hard-fail explicitly (the runtime auto-injection path has no equivalent loop).

`enable_a2ui` ships with agent-framework-ag-ui 1.2.0 (A2UI's first release) via
the `[a2ui]` extra; `ag-ui-a2ui-toolkit` supplies the validate->retry loop and
the recovery-exhausted envelope. Catalog is reused from declarative-gen-ui
("declarative-gen-ui-catalog") so no new components are introduced.
"""

from __future__ import annotations

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent, enable_a2ui

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"

# Keep this aligned with the declarative-gen-ui SYSTEM_PROMPT: a demo assistant
# that answers every question by drawing a surface. `generate_a2ui` (owned by
# `enable_a2ui` below) handles the rendering — and its automatic recovery —
# internally.
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

    The inner planner agent binds NO A2UI tool of its own — `enable_a2ui`
    injects the declaration-only `generate_a2ui` (whose body runs the render
    sub-agent + recovery loop). `chat_client` is a Chat-Completions client
    (`OpenAIChatCompletionClient`, see `agent_server._build_chat_client`), which
    the docstring on `enable_a2ui` recommends for the sub-agent so the balancing
    `render_a2ui` tool result replays cleanly on the next turn.
    """
    base_agent = Agent(
        client=chat_client,
        name="a2ui_recovery_agent",
        instructions=SYSTEM_PROMPT,
    )

    # `maxAttempts` pins the renderer's "Retrying… (N/M)" label to the adapter's
    # cap. Recovery + the recovery-exhausted hard-fail are toolkit defaults;
    # pinned here for the demo. The catalog arrives from the frontend via
    # context (same as declarative-gen-ui), so `default_catalog_id` only needs
    # to match the id the page registers.
    a2ui_runner = enable_a2ui(
        base_agent,
        chat_client,
        params={
            "recovery": {"maxAttempts": 3},
            "default_catalog_id": CUSTOM_CATALOG_ID,
        },
    )

    return AgentFrameworkAgent(
        agent=a2ui_runner,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description=(
            "Backend-owned A2UI generator with the validate->retry recovery "
            "loop made visible."
        ),
        require_confirmation=False,
    )
