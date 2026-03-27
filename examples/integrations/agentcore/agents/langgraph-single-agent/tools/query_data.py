"""Tool for querying the sample financial CSV dataset."""

import csv
import os
from langchain_core.tools import tool

_CSV_PATH = os.path.join(os.path.dirname(__file__), "db.csv")


@tool
def query_data(category: str = "", transaction_type: str = "") -> list[dict]:
    """
    Query the financial dataset. Optionally filter by category and/or type.

    Args:
        category: Filter by category (e.g. 'Food', 'Transport'). Empty = all.
        transaction_type: Filter by type ('income' or 'expense'). Empty = all.

    Returns:
        List of matching rows as dicts with keys: date, category, amount, type.
    """
    rows = []
    with open(_CSV_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if category and row["category"].lower() != category.lower():
                continue
            if transaction_type and row["type"].lower() != transaction_type.lower():
                continue
            rows.append({
                "date": row["date"],
                "category": row["category"],
                "amount": float(row["amount"]),
                "type": row["type"],
            })
    return rows
