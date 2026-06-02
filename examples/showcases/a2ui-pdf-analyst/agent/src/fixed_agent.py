"""Fixed-schema dashboard agent.

The user attaches a PDF in the chat. The deep agent reads the PDF text
(inlined into the user message by InlineDocumentsMiddleware) and calls
`render_dashboard` with the structured data extracted in the same model
pass. The dashboard surface includes an interactive scope-chips strip
that the agent populates from the document. Clicking a chip fires a
user action back to the agent, which re-renders with the new scope.
"""
from __future__ import annotations

from pathlib import Path
from typing import TypedDict

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID, CATALOG_PROMPT

SCHEMA_DIR = Path(__file__).parent / "a2ui" / "schemas"
DASHBOARD_SCHEMA = a2ui.load_schema(SCHEMA_DIR / "dashboard.json")
SURFACE = "pdf-dashboard"


class Kpi(TypedDict):
    label: str
    value: str
    delta: str
    caption: str


class Point(TypedDict):
    label: str
    value: float


class Row(TypedDict):
    name: str
    category: str
    value: str
    delta: str


class ScopeOption(TypedDict):
    label: str
    value: str


@tool
def render_dashboard(
    eyebrow: str,
    title: str,
    subtitle: str,
    kpis: list[Kpi],
    trend: list[Point],
    share: list[Point],
    rows: list[Row],
    scope_options: list[ScopeOption],
    scope_selected: str,
) -> str:
    """Render the interactive dashboard for the loaded PDF.

    Pass data INLINE. Call ONCE per turn.

    Required shapes:
      - kpis: EXACTLY 4 cards. Each {label, value, delta, caption}.

        STRICT FIELD RULES (very important; the badge breaks if you ignore):
          * `value`   = the headline number, formatted ("$94,930M", "23.4%",
                        "1.2M units"). 1–8 chars typically.
          * `delta`   = JUST the magnitude of change. Format: "+X%", "-X%",
                        or "" (empty string when there's no comparison).
                        MAX 8 chars. NEVER prose. NEVER "vs. last quarter"
                        or "vs. $89,498M". The arrow and color come from
                        the renderer.
                        Examples: "+6.1%", "-3%", "+12%", "+$2.4B", ""
                        Bad:      "↑ vs. $89,498M in Q4 FY23"
                                  "up 6% YoY"
                                  "increased from $89,498M"
          * `caption` = the comparison/context sentence ("vs. $89,498M in
                        Q4 FY23", "Products $69,958M; Services $24,972M",
                        "All-time high"). Up to ~80 chars. This is where
                        the prose goes.

      - trend: 6–12 points. {label, value:number}.
      - share: 3–5 slices. {label, value:number}.
      - rows: 5–8 table rows. Same delta rule applies: row.delta is
        SHORT ("+6%", "-3%", ""). Verbose comparisons belong elsewhere.
      - scope_options: 3–6 chips the user can click to re-scope. Each
        {label, value}. Example for an Apple earnings PDF:
          [{label:"Q4 FY24", value:"q4_fy24"},
           {label:"FY24",    value:"fy24"},
           {label:"By segment", value:"by_segment"},
           {label:"By region",  value:"by_region"}]
        Tailor the options to what THIS document actually supports.
      - scope_selected: the `value` of the currently active option.
    """
    payload = {
        "eyebrow": eyebrow,
        "title": title,
        "subtitle": subtitle,
        "kpis": kpis,
        "trend": trend,
        "share": share,
        "rows": rows,
        "scope": {"options": scope_options, "selected": scope_selected},
    }
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE, DASHBOARD_SCHEMA),
            a2ui.update_data_model(SURFACE, payload),
        ]
    )


SYSTEM_PROMPT = f"""\
You build and maintain a live dashboard from the user's PDF.

## How a turn works

The user may do three things on any turn:
  A) Attach a new PDF + chat (initial render).
  B) Send a chat message ("re-render focused on energy storage",
     "what was operating margin?", "compare last quarter").
  C) Click a scope chip on the dashboard. The runtime delivers this as a
     tool result `log_a2ui_event` with content like:
        User performed action "select_chip" on surface "pdf-dashboard".
        Context: {{"value": "fy24", "label": "Scope"}}

In every case, decide whether to re-render the dashboard, answer in chat,
or both.

## The render contract

When you render, call `render_dashboard(...)` ONCE with structured data:
  - 4 KPIs, 6–12 trend points, 3–5 share slices, 5–8 rows.
  - `scope_options`: 3–6 chips tailored to THIS PDF. Examples of good
    chip sets:
      - Apple Q4 PDF → [Q4 FY24, FY24, By segment, By region, By category]
      - Tesla Q3 PDF → [Q3 '24, By model, By region, Automotive vs Energy,
                       Trailing 4 quarters]
  - `scope_selected`: which chip is active. Default to the most natural
    starting scope for the document. After a chip click, set this to the
    clicked value.

When the user (or a chip click) asks to change scope:
  - Re-extract the data for the new scope from the PDF text.
  - Re-call render_dashboard with the SAME surfaceId so the canvas
    updates in place. The scope_selected reflects the new active chip.

## Hard rules

- Render the dashboard whenever the user attaches a PDF (initial), asks
  to re-render in any way, or clicks a chip.
- Call `render_dashboard` AT MOST ONCE per turn. Never twice.
- Use ONLY numbers that actually appear in the document.
- If the user asks an analytical question that does NOT require a layout
  change (e.g. "what was operating margin?"), answer in chat without
  re-rendering. 1–3 sentences max. Cite the number.
- If the user wants to invent a brand-new visualization not covered by
  the fixed schema (e.g. "show a sankey diagram"), tell them to use the
  Dynamic tab.

## Chat tone

Be helpful, brief, conversational. After the first render, you can
suggest one or two follow-ups the user might click ("Tap *FY24* for the
full-year view" or "Want me to break it down by segment?"). Don't list
more than two suggestions.

{CATALOG_PROMPT}
"""


def build_fixed_agent():
    return create_agent(
        model="openai:gpt-5.5",
        tools=[render_dashboard],
        # CopilotKitMiddleware forwards frontend tools + agent context (e.g.
        # useAgentContext payloads) to the LLM.
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=MemorySaver(),
    )


graph = build_fixed_agent()
