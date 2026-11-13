"""Prompts and App Context for the Vantage Threads showcase cell."""

from collections.abc import Iterable

from ag_ui.core import Context


SALES_CATALOG_ID = "declarative-gen-ui-catalog"

SALES_ANALYST_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional B2B "
    "apparel company described in your App Context. Answer every business "
    "question by calling `generate_a2ui` to draw a rich visual surface. Keep the "
    "chat reply to one short sentence. Ground every number in the sales dataset "
    "from App Context and follow its dashboard composition rules. Use `Metric` "
    "for KPIs, `DataTable` for rep performance, `StatusBadge` for risk, "
    "`InfoRow` for account facts, `PieChart` for part-of-whole breakdowns, and "
    "`BarChart` for trends or comparisons. Never ask which chart to use."
)


def with_app_context(prompt: str, context: Iterable[Context]) -> str:
    """Append the request's App Context to a model prompt."""
    entries = "\n\n".join(f"{entry.description}:\n{entry.value}" for entry in context)
    if not entries:
        return prompt
    return "\n\n".join(part for part in (prompt, f"App Context:\n{entries}") if part)
