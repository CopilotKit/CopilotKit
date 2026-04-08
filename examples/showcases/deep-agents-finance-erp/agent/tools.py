"""ERP tools — query and analyze finance data.

In production these would hit the Postgres database via SQLAlchemy.
For the demo, they return mock data matching the frontend fixtures.
"""

from __future__ import annotations

import json
from langchain_core.tools import tool


# ---------------------------------------------------------------------------
# Shared seed data (mirrors frontend src/lib/data.ts)
# ---------------------------------------------------------------------------

_INVOICES = [
    {"number": "INV-2026-001", "client": "Acme Corp", "amount": 45000, "status": "paid", "due": "2026-03-31"},
    {"number": "INV-2026-002", "client": "Globex Industries", "amount": 28500, "status": "pending", "due": "2026-04-10"},
    {"number": "INV-2026-003", "client": "Initech LLC", "amount": 67200, "status": "overdue", "due": "2026-03-15"},
    {"number": "INV-2026-004", "client": "Massive Dynamic", "amount": 18750, "status": "paid", "due": "2026-04-05"},
    {"number": "INV-2026-005", "client": "Umbrella Corp", "amount": 93400, "status": "pending", "due": "2026-04-20"},
    {"number": "INV-2026-006", "client": "Wayne Enterprises", "amount": 124000, "status": "draft", "due": "2026-04-28"},
    {"number": "INV-2026-007", "client": "Stark Industries", "amount": 56300, "status": "paid", "due": "2026-03-20"},
    {"number": "INV-2026-008", "client": "Soylent Industries", "amount": 34500, "status": "overdue", "due": "2026-03-01"},
    {"number": "INV-2026-009", "client": "Cyberdyne Systems", "amount": 51800, "status": "overdue", "due": "2026-03-10"},
]

_ACCOUNTS = [
    {"code": "1000", "name": "Cash & Equivalents", "type": "asset", "balance": 1245000},
    {"code": "1100", "name": "Accounts Receivable", "type": "asset", "balance": 542500},
    {"code": "1200", "name": "Inventory", "type": "asset", "balance": 312400},
    {"code": "1500", "name": "Fixed Assets", "type": "asset", "balance": 890000},
    {"code": "2000", "name": "Accounts Payable", "type": "liability", "balance": 234500},
    {"code": "2100", "name": "Short-term Loans", "type": "liability", "balance": 150000},
    {"code": "2500", "name": "Long-term Debt", "type": "liability", "balance": 520000},
    {"code": "3000", "name": "Owner's Equity", "type": "equity", "balance": 1850000},
    {"code": "3100", "name": "Retained Earnings", "type": "equity", "balance": 642100},
    {"code": "4000", "name": "Service Revenue", "type": "revenue", "balance": 2847350},
    {"code": "5000", "name": "Payroll Expense", "type": "expense", "balance": 580000},
    {"code": "5100", "name": "Operating Expense", "type": "expense", "balance": 625250},
]

_TRANSACTIONS = [
    {"date": "2026-03-31", "desc": "Acme Corp - Invoice Payment", "amount": 45000, "type": "credit", "category": "Revenue"},
    {"date": "2026-03-30", "desc": "AWS Infrastructure", "amount": 8420, "type": "debit", "category": "Infrastructure"},
    {"date": "2026-03-29", "desc": "Payroll - March Cycle", "amount": 48500, "type": "debit", "category": "Payroll"},
    {"date": "2026-03-28", "desc": "Stark Industries - Payment", "amount": 56300, "type": "credit", "category": "Revenue"},
    {"date": "2026-03-27", "desc": "Office Supplies", "amount": 2340, "type": "debit", "category": "Operations"},
    {"date": "2026-03-26", "desc": "Google Ads Campaign", "amount": 12500, "type": "debit", "category": "Marketing"},
    {"date": "2026-03-25", "desc": "Massive Dynamic - Payment", "amount": 18750, "type": "credit", "category": "Revenue"},
    {"date": "2026-03-24", "desc": "Software Licenses Renewal", "amount": 5600, "type": "debit", "category": "Infrastructure"},
    {"date": "2026-03-23", "desc": "Insurance Premium Q2", "amount": 15000, "type": "debit", "category": "Operations"},
    {"date": "2026-03-22", "desc": "Contractor Payment - Design", "amount": 7800, "type": "debit", "category": "Operations"},
    {"date": "2026-03-20", "desc": "Cyberdyne Systems - Partial Payment", "amount": 15000, "type": "credit", "category": "Revenue"},
    {"date": "2026-03-18", "desc": "Facebook Ads - Q1 Campaign", "amount": 18500, "type": "debit", "category": "Marketing"},
    {"date": "2026-03-15", "desc": "Payroll - March Cycle 1", "amount": 48500, "type": "debit", "category": "Payroll"},
    {"date": "2026-03-12", "desc": "Conference Sponsorship - SaaStr", "amount": 22000, "type": "debit", "category": "Marketing"},
    {"date": "2026-03-08", "desc": "Soylent Industries - Partial Payment", "amount": 10000, "type": "credit", "category": "Revenue"},
]

_INVENTORY = [
    {"sku": "HW-SRV-001", "name": "Dell PowerEdge R750", "qty": 12, "reorder": 5, "cost": 8500, "status": "in-stock"},
    {"sku": "HW-LAP-001", "name": "MacBook Pro 16\"", "qty": 3, "reorder": 10, "cost": 2499, "status": "low-stock"},
    {"sku": "HW-MON-001", "name": "LG UltraFine 5K", "qty": 28, "reorder": 15, "cost": 1299, "status": "in-stock"},
    {"sku": "SW-LIC-001", "name": "Microsoft 365 E5", "qty": 150, "reorder": 50, "cost": 57, "status": "in-stock"},
    {"sku": "HW-NET-001", "name": "Cisco Catalyst 9300", "qty": 0, "reorder": 3, "cost": 4200, "status": "out-of-stock"},
    {"sku": "HW-LAP-002", "name": "ThinkPad X1 Carbon", "qty": 8, "reorder": 10, "cost": 1849, "status": "low-stock"},
    {"sku": "HW-STO-001", "name": "Synology DS1621+", "qty": 6, "reorder": 3, "cost": 1099, "status": "in-stock"},
    {"sku": "SW-SEC-001", "name": "CrowdStrike Falcon", "qty": 200, "reorder": 100, "cost": 25, "status": "in-stock"},
]

_EMPLOYEES = [
    {"name": "Sarah Chen", "role": "CFO", "dept": "Finance", "salary": 195000, "status": "active"},
    {"name": "Marcus Williams", "role": "VP Engineering", "dept": "Engineering", "salary": 185000, "status": "active"},
    {"name": "Priya Patel", "role": "Head of Product", "dept": "Product", "salary": 172000, "status": "active"},
    {"name": "James Rodriguez", "role": "Senior Developer", "dept": "Engineering", "salary": 145000, "status": "active"},
    {"name": "Emily Thompson", "role": "HR Director", "dept": "Human Resources", "salary": 158000, "status": "active"},
    {"name": "David Kim", "role": "Financial Analyst", "dept": "Finance", "salary": 95000, "status": "on-leave"},
    {"name": "Lisa Nakamura", "role": "Marketing Manager", "dept": "Marketing", "salary": 118000, "status": "active"},
    {"name": "Robert Chen", "role": "DevOps Engineer", "dept": "Engineering", "salary": 135000, "status": "active"},
    {"name": "Ana Martinez", "role": "UX Designer", "dept": "Product", "salary": 112000, "status": "active"},
    {"name": "Tom Walsh", "role": "Sales Director", "dept": "Sales", "salary": 165000, "status": "active"},
    {"name": "Jordan Blake", "role": "Marketing Coordinator", "dept": "Marketing", "salary": 72000, "status": "active"},
]

# Quarterly financials (8 quarters: FY2024 Q1 – FY2025 Q4)
_QUARTERLY_REVENUE = [
    {"quarter": "Q1 2024", "revenue": 480000, "expenses": 340000, "profit": 140000},
    {"quarter": "Q2 2024", "revenue": 520000, "expenses": 355000, "profit": 165000},
    {"quarter": "Q3 2024", "revenue": 560000, "expenses": 370000, "profit": 190000},
    {"quarter": "Q4 2024", "revenue": 610000, "expenses": 390000, "profit": 220000},
    {"quarter": "Q1 2025", "revenue": 628000, "expenses": 383000, "profit": 245000},
    {"quarter": "Q2 2025", "revenue": 696000, "expenses": 390000, "profit": 306000},
    {"quarter": "Q3 2025", "revenue": 851000, "expenses": 435000, "profit": 416000},
    {"quarter": "Q4 2025", "revenue": 951000, "expenses": 457000, "profit": 494000},
]

# Cash flow components (quarterly)
_CASH_FLOW = [
    {"quarter": "Q1 2024", "operating": 95000, "investing": -45000, "financing": -20000, "net": 30000},
    {"quarter": "Q2 2024", "operating": 110000, "investing": -30000, "financing": -25000, "net": 55000},
    {"quarter": "Q3 2024", "operating": 135000, "investing": -55000, "financing": -15000, "net": 65000},
    {"quarter": "Q4 2024", "operating": 158000, "investing": -40000, "financing": -30000, "net": 88000},
    {"quarter": "Q1 2025", "operating": 170000, "investing": -60000, "financing": -20000, "net": 90000},
    {"quarter": "Q2 2025", "operating": 210000, "investing": -35000, "financing": -25000, "net": 150000},
    {"quarter": "Q3 2025", "operating": 285000, "investing": -70000, "financing": -50000, "net": 165000},
    {"quarter": "Q4 2025", "operating": 340000, "investing": -45000, "financing": -30000, "net": 265000},
]

# AR aging
_AR_AGING = {
    "current": 180000,
    "thirtyDay": 125000,
    "sixtyDay": 181300,
    "ninetyPlus": 56000,
    "total": 542300,
    "collectionRate": 0.84,
}

# Budget vs actual (Q1 2026)
_BUDGET_VS_ACTUAL = [
    {"category": "Revenue", "budget": 780000, "actual": 696000, "variance": -84000},
    {"category": "Payroll", "budget": 300000, "actual": 285000, "variance": 15000},
    {"category": "Operations", "budget": 160000, "actual": 152000, "variance": 8000},
    {"category": "Marketing", "budget": 120000, "actual": 158000, "variance": -38000},
    {"category": "Infrastructure", "budget": 100000, "actual": 93000, "variance": 7000},
    {"category": "R&D", "budget": 85000, "actual": 91000, "variance": -6000},
]

# Monthly expense by category (current fiscal year)
_MONTHLY_EXPENSES = [
    {"month": "Jan", "payroll": 48000, "operations": 23000, "marketing": 12000, "infrastructure": 15000, "rnd": 14000, "other": 7000},
    {"month": "Feb", "payroll": 48000, "operations": 23000, "marketing": 28000, "infrastructure": 15000, "rnd": 14000, "other": 7000},
    {"month": "Mar", "payroll": 49000, "operations": 24000, "marketing": 35000, "infrastructure": 16000, "rnd": 14000, "other": 7000},
    {"month": "Apr", "payroll": 48000, "operations": 23000, "marketing": 22000, "infrastructure": 15000, "rnd": 14000, "other": 7000},
    {"month": "May", "payroll": 48000, "operations": 22000, "marketing": 18000, "infrastructure": 15000, "rnd": 14000, "other": 6000},
    {"month": "Jun", "payroll": 48000, "operations": 23000, "marketing": 20000, "infrastructure": 16000, "rnd": 14000, "other": 7000},
    {"month": "Jul", "payroll": 49000, "operations": 24000, "marketing": 21000, "infrastructure": 16000, "rnd": 14000, "other": 7000},
    {"month": "Aug", "payroll": 48000, "operations": 23000, "marketing": 18000, "infrastructure": 15000, "rnd": 14000, "other": 7000},
    {"month": "Sep", "payroll": 49000, "operations": 24000, "marketing": 20000, "infrastructure": 16000, "rnd": 14000, "other": 7000},
    {"month": "Oct", "payroll": 48000, "operations": 23000, "marketing": 17000, "infrastructure": 15000, "rnd": 14000, "other": 6000},
    {"month": "Nov", "payroll": 49000, "operations": 23000, "marketing": 15000, "infrastructure": 16000, "rnd": 14000, "other": 7000},
    {"month": "Dec", "payroll": 48000, "operations": 22000, "marketing": 12000, "infrastructure": 15000, "rnd": 14000, "other": 7000},
]


# ---------------------------------------------------------------------------
# Invoice tools
# ---------------------------------------------------------------------------

@tool
def query_invoices(status: str | None = None) -> str:
    """Query invoices from the ERP system. Optionally filter by status (paid, pending, overdue, draft)."""
    invoices = _INVOICES
    if status:
        invoices = [inv for inv in invoices if inv["status"] == status]
    total = sum(inv["amount"] for inv in invoices)
    return f"Found {len(invoices)} invoices (total: ${total:,.0f}):\n" + "\n".join(
        f"  - {inv['number']} | {inv['client']} | ${inv['amount']:,.0f} | {inv['status']} | Due: {inv['due']}"
        for inv in invoices
    )


# ---------------------------------------------------------------------------
# Account tools
# ---------------------------------------------------------------------------

@tool
def query_accounts(account_type: str | None = None) -> str:
    """Query the chart of accounts. Optionally filter by type (asset, liability, equity, revenue, expense)."""
    accounts = _ACCOUNTS
    if account_type:
        accounts = [a for a in accounts if a["type"] == account_type]
    return f"Chart of Accounts ({len(accounts)} entries):\n" + "\n".join(
        f"  - [{a['code']}] {a['name']} ({a['type']}) — ${a['balance']:,.0f}"
        for a in accounts
    )


@tool
def query_transactions(limit: int = 10) -> str:
    """Query recent financial transactions from the ledger."""
    txns = _TRANSACTIONS[:limit]
    return f"Recent transactions ({len(txns)}):\n" + "\n".join(
        f"  - {t['date']} | {t['desc']} | {'+'if t['type']=='credit' else '-'}${t['amount']:,.0f} | {t['category']}"
        for t in txns
    )


# ---------------------------------------------------------------------------
# Inventory tools
# ---------------------------------------------------------------------------

@tool
def query_inventory(status: str | None = None) -> str:
    """Query inventory items. Optionally filter by status (in-stock, low-stock, out-of-stock)."""
    items = _INVENTORY
    if status:
        items = [i for i in items if i["status"] == status]
    total_value = sum(i["qty"] * i["cost"] for i in items)
    return f"Inventory ({len(items)} items, total value: ${total_value:,.0f}):\n" + "\n".join(
        f"  - [{i['sku']}] {i['name']} | Qty: {i['qty']} (reorder: {i['reorder']}) | ${i['cost']:,.0f}/unit | {i['status']}"
        for i in items
    )


# ---------------------------------------------------------------------------
# HR tools
# ---------------------------------------------------------------------------

@tool
def query_employees(department: str | None = None) -> str:
    """Query employee directory. Optionally filter by department."""
    employees = _EMPLOYEES
    if department:
        employees = [e for e in employees if e["dept"].lower() == department.lower()]
    total_payroll = sum(e["salary"] for e in employees if e["status"] == "active")
    return f"Employees ({len(employees)}, active payroll: ${total_payroll:,.0f}/yr):\n" + "\n".join(
        f"  - {e['name']} | {e['role']} | {e['dept']} | ${e['salary']:,.0f}/yr | {e['status']}"
        for e in employees
    )


# ---------------------------------------------------------------------------
# Analytics tools (data-driven)
# ---------------------------------------------------------------------------

@tool
def generate_financial_report(report_type: str = "summary") -> str:
    """Generate a financial report. Types: summary, balance_sheet, income_statement, cash_flow."""
    if report_type == "balance_sheet":
        assets = [a for a in _ACCOUNTS if a["type"] == "asset"]
        liabilities = [a for a in _ACCOUNTS if a["type"] == "liability"]
        equity = [a for a in _ACCOUNTS if a["type"] == "equity"]
        total_assets = sum(a["balance"] for a in assets)
        total_liabilities = sum(a["balance"] for a in liabilities)
        total_equity = sum(a["balance"] for a in equity)

        lines = ["BALANCE SHEET — As of March 31, 2026\n", "ASSETS"]
        for a in assets:
            lines.append(f"  {a['name']:30s} ${a['balance']:>12,.0f}")
        lines.append(f"{'TOTAL ASSETS':30s}   ${total_assets:>12,.0f}\n")
        lines.append("LIABILITIES")
        for a in liabilities:
            lines.append(f"  {a['name']:30s} ${a['balance']:>12,.0f}")
        lines.append(f"{'TOTAL LIABILITIES':30s}   ${total_liabilities:>12,.0f}\n")
        lines.append("EQUITY")
        for a in equity:
            lines.append(f"  {a['name']:30s} ${a['balance']:>12,.0f}")
        lines.append(f"{'TOTAL EQUITY':30s}   ${total_equity:>12,.0f}")
        return "\n".join(lines)

    elif report_type == "income_statement":
        rev = next(a["balance"] for a in _ACCOUNTS if a["code"] == "4000")
        expenses = [a for a in _ACCOUNTS if a["type"] == "expense"]
        total_exp = sum(a["balance"] for a in expenses)
        net_income = rev - total_exp
        margin = (net_income / rev * 100) if rev else 0

        lines = [
            "INCOME STATEMENT — FY 2026 (YTD through March)\n",
            "REVENUE",
            f"  Service Revenue             ${rev:>12,.0f}\n",
            "EXPENSES",
        ]
        for a in expenses:
            lines.append(f"  {a['name']:30s} ${a['balance']:>12,.0f}")
        lines.append(f"{'TOTAL EXPENSES':30s}   ${total_exp:>12,.0f}\n")
        lines.append(f"NET INCOME                    ${net_income:>12,.0f}")
        lines.append(f"Profit Margin                    {margin:.1f}%")
        return "\n".join(lines)

    elif report_type == "cash_flow":
        # Use the latest quarter's cash flow as representative
        latest = _CASH_FLOW[-1]
        return f"""CASH FLOW STATEMENT — Q4 2025

OPERATING ACTIVITIES
  Net Cash from Operations      ${latest['operating']:>12,.0f}

INVESTING ACTIVITIES
  Net Cash from Investing       ${latest['investing']:>12,.0f}

FINANCING ACTIVITIES
  Net Cash from Financing       ${latest['financing']:>12,.0f}

NET CHANGE IN CASH              ${latest['net']:>12,.0f}
"""

    else:
        rev = next(a["balance"] for a in _ACCOUNTS if a["code"] == "4000")
        cash = next(a["balance"] for a in _ACCOUNTS if a["code"] == "1000")
        ar = next(a["balance"] for a in _ACCOUNTS if a["code"] == "1100")
        debt = sum(a["balance"] for a in _ACCOUNTS if a["type"] == "liability")
        expenses = sum(a["balance"] for a in _ACCOUNTS if a["type"] == "expense")
        net_profit = rev - expenses
        overdue = [i for i in _INVOICES if i["status"] == "overdue"]
        low_stock = [i for i in _INVENTORY if i["status"] in ("low-stock", "out-of-stock")]

        return f"""FINANCIAL SUMMARY — March 2026

Key Metrics:
  • Revenue: ${rev:,.0f}
  • Net Profit: ${net_profit:,.0f} ({net_profit/rev*100:.1f}% margin)
  • Cash Position: ${cash:,.0f}
  • Accounts Receivable: ${ar:,.0f}
  • Total Debt: ${debt:,.0f}

Highlights:
  {'⚠️' if overdue else '✅'} {len(overdue)} overdue invoice(s) totaling ${sum(i['amount'] for i in overdue):,.0f}
  {'⚠️' if low_stock else '✅'} {len(low_stock)} inventory item(s) below reorder level
  ✅ Active payroll: ${sum(e['salary'] for e in _EMPLOYEES if e['status'] == 'active'):,.0f}/yr
"""


@tool
def analyze_cash_flow(months: int = 3) -> str:
    """Analyze cash flow trends. Uses quarterly historical data to compute trends and runway."""
    # Use the last N quarters (approximate months/3)
    num_quarters = max(1, min(len(_CASH_FLOW), (months + 2) // 3))
    recent = _CASH_FLOW[-num_quarters:]

    lines = [f"CASH FLOW ANALYSIS — Last {num_quarters} quarter(s)\n"]
    lines.append("Quarter     | Operating   | Investing   | Financing   | Net")
    lines.append("------------|-------------|-------------|-------------|----------")
    for q in recent:
        lines.append(
            f"{q['quarter']:12s}| ${q['operating']:>9,.0f} | ${q['investing']:>9,.0f} | "
            f"${q['financing']:>9,.0f} | ${q['net']:>9,.0f}"
        )

    avg_net = sum(q["net"] for q in recent) / len(recent)
    first_net, last_net = recent[0]["net"], recent[-1]["net"]
    trend_pct = ((last_net - first_net) / abs(first_net) * 100) if first_net else 0
    trend = "Improving" if trend_pct > 5 else "Declining" if trend_pct < -5 else "Stable"

    cash_balance = next(a["balance"] for a in _ACCOUNTS if a["code"] == "1000")
    avg_monthly_burn = sum(a["balance"] for a in _ACCOUNTS if a["type"] == "expense") / 12
    runway = cash_balance / avg_monthly_burn if avg_monthly_burn else float("inf")

    lines.append(f"\nSummary:")
    lines.append(f"  • Average quarterly net cash flow: ${avg_net:,.0f}")
    lines.append(f"  • Trend: {trend} ({trend_pct:+.0f}% over period)")
    lines.append(f"  • Cash runway at current burn: {runway:.1f} months")
    lines.append(f"  • AR collection rate: {_AR_AGING['collectionRate']*100:.0f}%")

    return "\n".join(lines)


@tool
def forecast_revenue(quarters: int = 4) -> str:
    """Forecast revenue for upcoming quarters based on historical growth trends."""
    # Compute average QoQ growth rate from last 4 quarters
    recent = _QUARTERLY_REVENUE[-4:]
    growth_rates = []
    for i in range(1, len(recent)):
        prev = recent[i - 1]["revenue"]
        curr = recent[i]["revenue"]
        growth_rates.append((curr - prev) / prev)

    avg_growth = sum(growth_rates) / len(growth_rates) if growth_rates else 0
    # Growth rate volatility for confidence
    if len(growth_rates) > 1:
        mean = avg_growth
        variance = sum((r - mean) ** 2 for r in growth_rates) / len(growth_rates)
        volatility = variance ** 0.5
    else:
        volatility = 0.1

    # Project forward
    last_rev = _QUARTERLY_REVENUE[-1]["revenue"]
    quarter_labels = ["Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027"]
    projections = []
    current = last_rev
    for i in range(min(quarters, len(quarter_labels))):
        current = int(current * (1 + avg_growth))
        confidence = "High" if i == 0 else "Medium" if i < 3 else "Low"
        if volatility > 0.08:
            confidence = "Medium" if i == 0 else "Low"
        projections.append({"quarter": quarter_labels[i], "projected": current, "confidence": confidence})

    total = sum(p["projected"] for p in projections)
    fy2025_total = sum(q["revenue"] for q in _QUARTERLY_REVENUE[-4:])
    yoy_change = ((total - fy2025_total) / fy2025_total * 100) if fy2025_total else 0

    lines = [f"REVENUE FORECAST — Next {quarters} Quarters\n"]
    lines.append(f"Methodology: Average QoQ growth rate of {avg_growth*100:.1f}% "
                 f"computed from last 4 quarters (volatility: {volatility*100:.1f}%)\n")
    lines.append("Quarter     | Projected   | Confidence")
    lines.append("------------|-------------|----------")
    for p in projections:
        lines.append(f"{p['quarter']:12s}| ${p['projected']:>9,.0f} | {p['confidence']}")

    lines.append(f"\nProjected Total: ${total:,.0f} ({yoy_change:+.1f}% vs FY2025)")
    lines.append(f"\nKey Assumptions:")
    lines.append(f"  • Based on {avg_growth*100:.1f}% average QoQ growth from recent quarters")
    lines.append(f"  • Last quarter revenue: ${last_rev:,.0f}")
    lines.append(f"  • Pipeline includes Umbrella Corp ($93K) and Wayne Enterprises ($124K)")

    overdue = [i for i in _INVOICES if i["status"] == "overdue"]
    if overdue:
        lines.append(f"\nRisks:")
        for inv in overdue:
            lines.append(f"  ⚠️ {inv['client']} has ${inv['amount']:,.0f} overdue — churn risk")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Data query tools (return raw data for projections agent)
# ---------------------------------------------------------------------------

@tool
def query_quarterly_financials(last_n: int = 8) -> str:
    """Return raw quarterly financial data (revenue, expenses, profit) as JSON for analysis."""
    data = _QUARTERLY_REVENUE[-last_n:]
    return json.dumps(data, indent=2)


@tool
def query_cash_flow_components(last_n: int = 8) -> str:
    """Return raw quarterly cash flow component data (operating, investing, financing, net) as JSON."""
    data = _CASH_FLOW[-last_n:]
    return json.dumps(data, indent=2)


@tool
def query_budget_vs_actual() -> str:
    """Return budget vs actual data for the current quarter (Q1 2026) as JSON."""
    return json.dumps(_BUDGET_VS_ACTUAL, indent=2)


@tool
def query_ar_aging() -> str:
    """Return accounts receivable aging breakdown as JSON."""
    return json.dumps(_AR_AGING, indent=2)


@tool
def query_monthly_expenses(category: str | None = None) -> str:
    """Return monthly expense data for the current fiscal year as JSON.

    Each entry has month plus expense amounts by category.
    Optionally filter to a single category: payroll, operations, marketing,
    infrastructure, rnd, other.
    """
    if category:
        cat = category.lower().replace("&", "").replace(" ", "")
        if cat == "rd":
            cat = "rnd"
        data = [{"month": row["month"], category: row.get(cat, 0)} for row in _MONTHLY_EXPENSES]
    else:
        data = _MONTHLY_EXPENSES
    return json.dumps(data, indent=2)


# ---------------------------------------------------------------------------
# Projection tools (compute forecasts from historical data)
# ---------------------------------------------------------------------------

def _compute_growth_rates(values: list[float]) -> list[float]:
    """Compute period-over-period growth rates."""
    rates = []
    for i in range(1, len(values)):
        if values[i - 1] != 0:
            rates.append((values[i] - values[i - 1]) / abs(values[i - 1]))
    return rates


def _project_forward(last_value: float, avg_growth: float, periods: int,
                     optimistic_mult: float = 1.0) -> list[float]:
    """Project values forward using compound growth."""
    result = []
    current = last_value
    for _ in range(periods):
        current = current * (1 + avg_growth * optimistic_mult)
        result.append(round(current))
    return result


@tool
def compute_revenue_forecast(quarters: int = 4, method: str = "linear") -> str:
    """Project revenue for future quarters using historical growth rates.

    Args:
        quarters: Number of quarters to project (1-8).
        method: "linear" (average growth rate) or "seasonal" (accounts for seasonal patterns).

    Returns JSON with projected quarterly revenue, growth rate used, and confidence metrics.
    """
    data = _QUARTERLY_REVENUE
    revenues = [q["revenue"] for q in data]
    expenses = [q["expenses"] for q in data]

    if method == "seasonal" and len(data) >= 8:
        # Use YoY growth for corresponding quarters
        quarter_labels = ["Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027",
                          "Q2 2027", "Q3 2027", "Q4 2027", "Q1 2028"]
        projections = []
        for i in range(min(quarters, len(quarter_labels))):
            # Find the same quarter from last year
            hist_idx = (i + 1) % 4 + 4  # index into FY2025 quarters
            base_idx = hist_idx - 4      # same quarter from FY2024
            yoy_growth = (data[hist_idx]["revenue"] - data[base_idx]["revenue"]) / data[base_idx]["revenue"]
            projected_rev = int(data[hist_idx]["revenue"] * (1 + yoy_growth))
            projected_exp = int(data[hist_idx]["expenses"] * (1 + yoy_growth * 0.7))
            projections.append({
                "quarter": quarter_labels[i],
                "revenue": projected_rev,
                "expenses": projected_exp,
                "profit": projected_rev - projected_exp,
                "yoy_growth_pct": round(yoy_growth * 100, 1),
            })
    else:
        # Linear: average QoQ growth
        growth_rates = _compute_growth_rates(revenues)
        avg_growth = sum(growth_rates[-4:]) / min(4, len(growth_rates)) if growth_rates else 0
        exp_growth_rates = _compute_growth_rates(expenses)
        avg_exp_growth = sum(exp_growth_rates[-4:]) / min(4, len(exp_growth_rates)) if exp_growth_rates else 0

        quarter_labels = ["Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027",
                          "Q2 2027", "Q3 2027", "Q4 2027", "Q1 2028"]
        projected_rev = _project_forward(revenues[-1], avg_growth, min(quarters, len(quarter_labels)))
        projected_exp = _project_forward(expenses[-1], avg_exp_growth, min(quarters, len(quarter_labels)))

        projections = []
        for i in range(min(quarters, len(quarter_labels))):
            projections.append({
                "quarter": quarter_labels[i],
                "revenue": projected_rev[i],
                "expenses": projected_exp[i],
                "profit": projected_rev[i] - projected_exp[i],
                "qoq_growth_pct": round(avg_growth * 100, 1),
            })

    # Confidence metrics
    recent_growth = _compute_growth_rates(revenues[-4:])
    if len(recent_growth) > 1:
        mean_g = sum(recent_growth) / len(recent_growth)
        std_g = (sum((r - mean_g) ** 2 for r in recent_growth) / len(recent_growth)) ** 0.5
    else:
        mean_g = recent_growth[0] if recent_growth else 0
        std_g = 0

    result = {
        "method": method,
        "historical_quarters_used": len(data),
        "avg_quarterly_growth_pct": round(mean_g * 100, 1),
        "growth_volatility_pct": round(std_g * 100, 1),
        "projections": projections,
    }
    return json.dumps(result, indent=2)


@tool
def compute_cash_flow_forecast(quarters: int = 4) -> str:
    """Project cash flow components (operating, investing, financing) for future quarters.

    Returns JSON with projected quarterly cash flow by component.
    """
    operating = [q["operating"] for q in _CASH_FLOW]
    investing = [q["investing"] for q in _CASH_FLOW]
    financing = [q["financing"] for q in _CASH_FLOW]

    op_growth = _compute_growth_rates(operating)
    avg_op = sum(op_growth[-4:]) / min(4, len(op_growth)) if op_growth else 0

    # For investing/financing, use average absolute values (they're typically negative)
    avg_inv = sum(investing[-4:]) / 4
    avg_fin = sum(financing[-4:]) / 4

    quarter_labels = ["Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027"]
    proj_op = _project_forward(operating[-1], avg_op, min(quarters, 4))

    projections = []
    for i in range(min(quarters, 4)):
        inv = round(avg_inv * (1 + 0.05 * i))  # slight increase in investment
        fin = round(avg_fin)
        net = proj_op[i] + inv + fin
        projections.append({
            "quarter": quarter_labels[i],
            "operating": proj_op[i],
            "investing": inv,
            "financing": fin,
            "net": net,
        })

    cash_balance = next(a["balance"] for a in _ACCOUNTS if a["code"] == "1000")
    cumulative = cash_balance
    for p in projections:
        cumulative += p["net"]
        p["projected_cash_balance"] = cumulative

    result = {
        "current_cash": cash_balance,
        "operating_growth_pct": round(avg_op * 100, 1),
        "projections": projections,
    }
    return json.dumps(result, indent=2)


@tool
def run_scenario_analysis(metric: str = "revenue", quarters: int = 4) -> str:
    """Run best/base/worst case scenario analysis for a financial metric.

    Args:
        metric: "revenue", "profit", or "cash_flow"
        quarters: Number of quarters to project (1-4)

    Returns JSON with three scenarios (optimistic, base, conservative) each containing
    quarterly projections.
    """
    quarter_labels = ["Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027"][:quarters]

    if metric == "revenue":
        values = [q["revenue"] for q in _QUARTERLY_REVENUE]
    elif metric == "profit":
        values = [q["profit"] for q in _QUARTERLY_REVENUE]
    elif metric == "cash_flow":
        values = [q["net"] for q in _CASH_FLOW]
    else:
        return json.dumps({"error": f"Unknown metric: {metric}. Use revenue, profit, or cash_flow."})

    growth_rates = _compute_growth_rates(values)
    avg_growth = sum(growth_rates[-4:]) / min(4, len(growth_rates)) if growth_rates else 0
    last_val = values[-1]

    scenarios = {}
    for name, mult in [("optimistic", 1.5), ("base", 1.0), ("conservative", 0.5)]:
        projected = _project_forward(last_val, avg_growth, quarters, optimistic_mult=mult)
        scenarios[name] = [
            {"quarter": quarter_labels[i], "value": projected[i]}
            for i in range(quarters)
        ]

    result = {
        "metric": metric,
        "base_growth_rate_pct": round(avg_growth * 100, 1),
        "last_actual_value": last_val,
        "scenarios": scenarios,
    }
    return json.dumps(result, indent=2)


@tool
def compute_trend_analysis(metric: str = "revenue") -> str:
    """Analyze historical growth rates, YoY comparisons, and seasonal patterns.

    Args:
        metric: "revenue", "expenses", "profit", "operating_cash_flow", or "net_cash_flow"

    Returns JSON with QoQ growth rates, YoY comparisons, and trend summary.
    """
    if metric in ("revenue", "expenses", "profit"):
        data = _QUARTERLY_REVENUE
        values = [q[metric] for q in data]
        labels = [q["quarter"] for q in data]
    elif metric == "operating_cash_flow":
        data = _CASH_FLOW
        values = [q["operating"] for q in data]
        labels = [q["quarter"] for q in data]
    elif metric == "net_cash_flow":
        data = _CASH_FLOW
        values = [q["net"] for q in data]
        labels = [q["quarter"] for q in data]
    else:
        return json.dumps({"error": f"Unknown metric: {metric}"})

    growth_rates = _compute_growth_rates(values)

    # QoQ detail
    qoq = []
    for i in range(1, len(values)):
        qoq.append({
            "from": labels[i - 1],
            "to": labels[i],
            "value": values[i],
            "growth_pct": round(growth_rates[i - 1] * 100, 1),
        })

    # YoY comparisons (Q1 vs Q1, etc.)
    yoy = []
    if len(values) >= 8:
        for i in range(4):
            prev_yr = values[i]
            curr_yr = values[i + 4]
            change = ((curr_yr - prev_yr) / abs(prev_yr) * 100) if prev_yr else 0
            yoy.append({
                "quarter_pair": f"{labels[i]} → {labels[i+4]}",
                "previous": prev_yr,
                "current": curr_yr,
                "yoy_change_pct": round(change, 1),
            })

    avg_growth = sum(growth_rates) / len(growth_rates) if growth_rates else 0
    recent_avg = sum(growth_rates[-4:]) / min(4, len(growth_rates)) if growth_rates else 0
    accelerating = recent_avg > avg_growth

    result = {
        "metric": metric,
        "periods": len(values),
        "min": min(values),
        "max": max(values),
        "latest": values[-1],
        "overall_avg_growth_pct": round(avg_growth * 100, 1),
        "recent_avg_growth_pct": round(recent_avg * 100, 1),
        "trend": "accelerating" if accelerating else "decelerating",
        "qoq_detail": qoq,
        "yoy_comparisons": yoy,
    }
    return json.dumps(result, indent=2)


# ---------------------------------------------------------------------------
# Exported tool lists
# ---------------------------------------------------------------------------

research_tools = [
    query_invoices,
    query_accounts,
    query_transactions,
    query_inventory,
    query_employees,
    generate_financial_report,
    analyze_cash_flow,
    forecast_revenue,
    query_quarterly_financials,
    query_cash_flow_components,
    query_budget_vs_actual,
    query_ar_aging,
    query_monthly_expenses,
]

projections_tools = [
    compute_revenue_forecast,
    compute_cash_flow_forecast,
    run_scenario_analysis,
    compute_trend_analysis,
    query_quarterly_financials,
    query_cash_flow_components,
]
