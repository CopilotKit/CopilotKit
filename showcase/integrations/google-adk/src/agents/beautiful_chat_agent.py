"""Agent backing the Beautiful Chat demo.

A canonical "polished starter" agent — has the sales-pipeline tools
(`query_data`, `search_flights`, `manage_sales_todos`, `get_sales_todos`)
so the demo can showcase chart cards, flight cards, task manager (shared
state), and dynamic A2UI sales dashboards alongside the brand fonts, theme
tokens, and suggestion pills on the frontend.

`generate_a2ui` is the middleware's `get_a2ui_tool()` (ag-ui-adk >= 0.7.0),
wired backend-owned: the no-arg tool drives the render_a2ui sub-agent +
toolkit recovery loop + recovery-exhausted hard-fail envelope (OSS-158),
replacing the old hand-rolled google.genai planner. The route keeps
`injectA2UITool: false` so the runtime does not double-inject (matching the
AWS Strands / ag2 external-framework convention).

Tool surface matches the LP reference at
showcase/integrations/langgraph-python/src/agents/beautiful_chat.py:
- query_data           — financial rows for pie/bar charts
- manage_todos         — exposed as `manage_sales_todos` on ADK to reuse
                         the shared sales-pipeline impl (Task Manager pill)
- get_todos            — exposed as `get_sales_todos`
- search_flights       — A2UI fixed-schema flight cards
- generate_a2ui        — A2UI dynamic-schema sales dashboard (auto-injected)

`schedule_meeting` is intentionally NOT on the agent: the frontend
registers a `scheduleTime` `useFrontendTool` (HITL) so the meeting
picker UI is driven entirely client-side. See
showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/
hooks/use-generative-ui-examples.tsx.
"""

from __future__ import annotations

import logging

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from ag_ui_adk import AGUIToolset, get_a2ui_tool

from agents.shared_chat import get_a2ui_model, get_model, stop_on_terminal_text

# Shared tool implementations (via tools symlink -> ../../shared/python/tools).
from tools import (
    query_data_impl,
    search_flights_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
)

load_dotenv()

logger = logging.getLogger(__name__)


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial data — returns rows for pie / bar charts.

    Always call this before showing a chart or graph; the
    Pie Chart / Bar Chart frontend renderers expect rows shaped by
    `tools.query_data_impl`.
    """
    return query_data_impl(query)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich A2UI cards.

    Return EXACTLY 2 flights so the FlightCard surface lays out cleanly
    in the Beautiful Chat transcript. Each flight must carry:
    airline, airlineLogo (Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128 —
    e.g. domain=united.com for United, delta.com for Delta, aa.com for
    American, alaskaair.com for Alaska),
    flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" — use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"), and price (e.g. "$289").
    """
    return search_flights_impl(flights)


def manage_sales_todos(tool_context: ToolContext, todos: list[dict]) -> dict:
    """Manage the Task Manager todos by persisting the complete list.

    The Beautiful Chat "Task Manager (Shared State)" pill expects the
    agent to overwrite `state["todos"]` wholesale on every invocation —
    pass the COMPLETE list, never a delta. Returns `{status, count}` so
    the LLM can craft a brief follow-up summary.
    """
    result = manage_sales_todos_impl(todos)
    tool_context.state["todos"] = result
    return {"status": "updated", "count": len(result)}


def get_sales_todos(tool_context: ToolContext) -> list:
    """Get the current Task Manager todos for the Beautiful Chat demo."""
    return get_sales_todos_impl(tool_context.state.get("todos"))


# Ported (with light adaptation for ADK tool naming) from LP's
# beautiful_chat.py system_prompt. The frontend exercises 9 pills covering
# A2UI fixed + dynamic, controlled GenUI charts, MCP apps, HITL meetings,
# Open Gen UI calculator, frontend tools, and shared-state todos — so the
# agent needs concise per-tool guidance to pick the right surface.
_INSTRUCTION = """
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Flights: call search_flights to show flight cards with a pre-built schema.
        - Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
          charts, tables, and cards. It handles rendering automatically.
        - Charts: call query_data first, then render with the chart component.
        - Todos / Task Manager: call manage_sales_todos to update the complete todo
          list, or get_sales_todos to read the current list before discussing them.
          Always pass the COMPLETE list to manage_sales_todos.
        - Interactive / sandboxed widgets (calculator, custom forms, mini-apps):
          call generateSandboxedUi to create a self-contained HTML+CSS+JS widget
          rendered inside a sandboxed iframe. Use this when the user asks for
          something that isn't a dashboard (so generate_a2ui doesn't apply) but
          benefits from a live, interactive UI — calculators, color pickers,
          quizzes, etc. Keep the chat reply to one short sentence; the rendered
          widget is the real output.

          Sandbox iframe restrictions (CRITICAL — these are silently enforced by
          the browser, so the LLM has to know):
          - The iframe runs with `sandbox="allow-scripts"` ONLY. `<form>` and
            `<button type="submit">` are blocked BEFORE any onsubmit handler
            runs — never use a form for interactivity.
          - Use plain `<button type="button">` elements and wire them with
            `addEventListener('click', ...)`. Do the same for keyboard input:
            attach a `keydown` listener that checks `e.key === 'Enter'` and
            calls your handler directly instead of wrapping inputs in a form.
          - All click/keypress handlers must live inside a `<script>` tag in
            the generated `html` (the iframe runs the html plus a small
            postMessage shim). Top-level expressions are fine; no `fetch`,
            no `localStorage`, no `document.cookie`.
          - For calculators: render `<button type="button" data-key="7">7</button>`
            etc. and a single `document.addEventListener('click', e => { ... })`
            that reads `e.target.dataset.key` and updates an output `<div>`.
            Wire the metric-shortcut buttons the same way; reading their
            `data-value` to push the numeric value into the display.
        - A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
          respond with a brief confirmation. The UI already updated on the frontend.
        - Meeting scheduling is handled entirely on the frontend via the
          `scheduleTime` HITL tool — do NOT try to schedule meetings yourself.
"""


beautiful_chat_agent = LlmAgent(
    name="BeautifulChatAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    # Backend-owned A2UI: `generate_a2ui` is the middleware's get_a2ui_tool
    # (no-arg) — drives the render_a2ui sub-agent + recovery loop + hard-fail
    # envelope (ag-ui-adk >= 0.7.0, OSS-158), replacing the old hand-rolled
    # google.genai planner. Route stays injectA2UITool: false so the runtime
    # does not double-inject (coexists with openGenerativeUI + mcpApps).
    tools=[
        query_data,
        search_flights,
        manage_sales_todos,
        get_sales_todos,
        get_a2ui_tool(
            {
                "model": get_a2ui_model(),
                "default_catalog_id": "copilotkit://app-dashboard-catalog",
            }
        ),
        AGUIToolset(),
    ],
    after_model_callback=stop_on_terminal_text,
)
