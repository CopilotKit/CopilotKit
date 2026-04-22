"""Query data tool implementation — reads db.csv at module load time."""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any

_logger = logging.getLogger(__name__)

_csv_path = Path(__file__).resolve().parent.parent / "data" / "db.csv"

_MOCK_DATA = [
    {
        "date": "2026-01-05",
        "category": "Revenue",
        "subcategory": "Enterprise Subscriptions",
        "amount": "28000",
        "type": "income",
        "notes": "3 new enterprise customers",
    },
    {
        "date": "2026-01-10",
        "category": "Expenses",
        "subcategory": "Engineering Salaries",
        "amount": "42000",
        "type": "expense",
        "notes": "7 engineers + 2 contractors",
    },
    {
        "date": "2026-02-03",
        "category": "Revenue",
        "subcategory": "Pro Tier Upgrades",
        "amount": "22500",
        "type": "income",
        "notes": "31 upgrades + reduced churn",
    },
]

try:
    with open(_csv_path) as _f:
        _cached_data: list[dict[str, Any]] = list(csv.DictReader(_f))
    if not _cached_data:
        _logger.warning("CSV at %s is empty, falling back to mock data", _csv_path)
        _cached_data = _MOCK_DATA
except (FileNotFoundError, OSError) as exc:
    _logger.warning("Could not load CSV at %s (%s), falling back to mock data", _csv_path, exc)
    _cached_data = _MOCK_DATA

def query_data_impl(query: str) -> list[dict[str, Any]]:
    """Query the database. Takes natural language.

    Always call before showing a chart or graph. Returns the full
    dataset as a list of dicts (rows from the CSV).
    """
    return _cached_data
