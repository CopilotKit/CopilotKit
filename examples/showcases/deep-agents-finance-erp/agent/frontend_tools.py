"""Consolidated frontend tool stubs (5 tools, down from 14).

These tools are registered at agent creation time so the model can call them
via function calling. The AG-UI adapter streams ToolCall events, which the
CopilotKit frontend matches to useFrontendTool renderers by name.

Rendering tools return a simple confirmation string.
HITL tools use copilotkit_interrupt() to pause the graph for user approval.
"""

from typing import Optional
from langchain_core.tools import tool
from copilotkit.langgraph import copilotkit_interrupt


# ---------------------------------------------------------------------------
# 1. render_chat_visual — inline visuals in the chat
# ---------------------------------------------------------------------------

@tool
def render_chat_visual(type: str, title: str, data: list, series: list,
                       totalCash: Optional[float] = None,
                       totalLiabilities: Optional[float] = None,
                       netPosition: Optional[float] = None,
                       accounts: Optional[list] = None,
                       chartType: Optional[str] = None) -> str:
    """Render a visual component inline in the chat.

    Args:
        type: Visual type — 'chart' for an interactive chart, 'cash_position' for a cash summary card.
        title: Title displayed on the visual.
        data: Data points. For charts: each has label (str), value (number), optional value2 (number).
              For cash_position: ignored (use accounts instead).
        series: Series config for charts. Each has key ('value' or 'value2'), color (hex), label.
                For cash_position: ignored.
        totalCash: (cash_position only) Total cash and cash equivalents.
        totalLiabilities: (cash_position only) Total liabilities.
        netPosition: (cash_position only) Net position (totalCash - totalLiabilities).
        accounts: (cash_position only) Cash and asset accounts. Each has name (str) and balance (number).
        chartType: (chart only) Chart subtype — 'area' for trends, 'bar' for comparisons, 'line' for trajectories. Default: 'area'.
    """
    if type == "cash_position":
        return f"Cash position card rendered. Net: ${netPosition or 0:,.0f}"
    return f"Chart '{title}' rendered."


# ---------------------------------------------------------------------------
# 2. navigate_and_filter — SPA navigation
# ---------------------------------------------------------------------------

@tool
def navigate_and_filter(page: str, filter: Optional[str] = None) -> str:
    """Navigate to an ERP page and optionally apply a filter.

    Args:
        page: Page to navigate to — dashboard, invoices, accounts, inventory, or hr.
        filter: Optional filter. Invoices: paid|pending|overdue|draft. Inventory: in-stock|low-stock|out-of-stock.
    """
    msg = f"Navigated to {page}"
    if filter:
        msg += f" with filter '{filter}'"
    return msg


# ---------------------------------------------------------------------------
# 3. request_approval — human-in-the-loop
# ---------------------------------------------------------------------------

@tool
def request_approval(type: str, invoices: Optional[list] = None,
                     totalAmount: Optional[float] = None,
                     action: Optional[str] = None,
                     items: Optional[list] = None,
                     estimatedTotal: Optional[float] = None,
                     supplier: Optional[str] = None) -> str:
    """Request human approval for a financial action. MANDATORY before processing payments or reorders.

    Args:
        type: Approval type — 'invoice_payment' or 'inventory_reorder'.
        invoices: (invoice_payment only) Invoices to approve. Each has number, client, amount, dueDate.
        totalAmount: (invoice_payment only) Sum of all invoice amounts.
        action: (invoice_payment only) Description, e.g. 'Process payment for 3 overdue invoices'.
        items: (inventory_reorder only) Items to reorder. Each has sku, name, currentQty, reorderQty, unitCost.
        estimatedTotal: (inventory_reorder only) Total estimated cost of the purchase order.
        supplier: (inventory_reorder only) Supplier name, if known.
    """
    if type == "invoice_payment":
        answer, _ = copilotkit_interrupt(
            action="request_approval",
            args={"type": "invoice_payment", "invoices": invoices,
                  "totalAmount": totalAmount, "action": action},
        )
    else:
        answer, _ = copilotkit_interrupt(
            action="request_approval",
            args={"type": "inventory_reorder", "items": items,
                  "estimatedTotal": estimatedTotal, "supplier": supplier or ""},
        )
    return answer


# ---------------------------------------------------------------------------
# 4. update_dashboard — add/update dashboard widgets (batch)
# ---------------------------------------------------------------------------

@tool
def update_dashboard(widgets: list) -> str:
    """Add or update one or more dashboard widgets in a single call.

    Args:
        widgets: Array of widget configs. Each widget has:
            - type (str): Widget type — 'kpi_cards', 'revenue_chart', 'expense_breakdown',
              'transactions', 'invoices', or 'custom_chart'.
            - colSpan (int, optional): Grid column span 1-4. Defaults vary by type.
            - config (dict, optional): Type-specific configuration:
              * kpi_cards: { metrics?: string[] } — KPI labels to show.
              * revenue_chart: { showProfit?: bool, showExpenses?: bool }
              * expense_breakdown: { categories?: string[] }
              * transactions: { limit?: int }
              * invoices: { statuses?: ['pending', 'overdue'] }
              * custom_chart: { title: str, subtitle?: str, chartType: 'area'|'bar'|'line',
                  data: [{label, value, value2?, value3?}], series: [{key, color, label}],
                  formatValues?: 'currency'|'number'|'percent' }
    """
    types = [w.get("type", "widget") for w in widgets]
    return f"Dashboard updated: {', '.join(types)}"


# ---------------------------------------------------------------------------
# 5. manage_dashboard — remove, reorder, or reset
# ---------------------------------------------------------------------------

@tool
def manage_dashboard(action: str, widgetId: Optional[str] = None,
                     updates: Optional[list] = None) -> str:
    """Manage the dashboard layout.

    Args:
        action: Action to perform — 'remove' (delete a widget), 'reorder' (resize/reorder widgets),
                or 'reset' (restore default layout).
        widgetId: (remove only) ID of the widget to remove.
        updates: (reorder only) Array of updates. Each has widgetId (str), optional colSpan (1-4), optional order (int).
    """
    if action == "reset":
        return "Dashboard reset to defaults."
    if action == "remove":
        return f"Widget '{widgetId}' removed."
    if action == "reorder" and updates:
        return f"Updated {len(updates)} widget(s)."
    return f"Dashboard action '{action}' completed."


# ---------------------------------------------------------------------------
# 6. save_dashboard — persist current dashboard layout
# ---------------------------------------------------------------------------

@tool
def save_dashboard(name: str) -> str:
    """Save the current dashboard layout with a name for later retrieval.

    Args:
        name: A descriptive name for this dashboard configuration (e.g. 'Q1 Cash Flow Review').
    """
    return f"Dashboard saved as '{name}'."


# ---------------------------------------------------------------------------
# 7. load_dashboard — restore a previously saved dashboard
# ---------------------------------------------------------------------------

@tool
def load_dashboard(name: str) -> str:
    """Load a previously saved dashboard by name (fuzzy match).

    Args:
        name: Name of the saved dashboard to load.
    """
    return f"Dashboard '{name}' loaded."


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

# Tools whose execution is intercepted by CopilotKitMiddleware and forwarded to
# the frontend for rendering via useFrontendTool.
ui_tools = [
    render_chat_visual,
    navigate_and_filter,
    update_dashboard,
    manage_dashboard,
    save_dashboard,
    load_dashboard,
]

# Human-in-the-loop tools — execute on the backend via copilotkit_interrupt().
hitl_tools = [
    request_approval,
]

# All frontend tools
frontend_tools = [*ui_tools, *hitl_tools]
