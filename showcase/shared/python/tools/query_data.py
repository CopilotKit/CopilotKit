"""Query data tool implementation — reads db.csv at module load time."""

from __future__ import annotations

import csv
import logging
import os
import sys
from pathlib import Path
from typing import Any

_logger = logging.getLogger(__name__)

# NOTE: the dataset MUST live inside the `tools/` package. Every integration
# Dockerfile copies `tools/` (the symlink to showcase/shared/python/tools), but
# none copied the former sibling `shared/python/data/`, so the CSV was absent at
# runtime and the silent fallback below served a 3-row mock — visible as a
# 2-slice pie / 1-bar chart in the beautiful-chat demos of 8 integrations.
_csv_path = Path(__file__).resolve().parent / "data" / "db.csv"

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

def _fail_or_mock(reason: str) -> list[dict[str, Any]]:
    """Fail LOUD on a missing/empty dataset instead of silently degrading.

    The 3-row ``_MOCK_DATA`` above is a developer convenience, but when it is
    served unnoticed the beautiful-chat demos render a 2-slice pie chart and a
    1-bar bar chart while looking "fine" — the exact bug this guard exists to
    prevent. A warning was not enough: these integrations run the agent as a
    child process whose stdout is not captured, so the warning was invisible
    and the wrong data shipped.

    Set ``SHOWCASE_ALLOW_MOCK_DATASET=1`` to opt into the mock (unit tests,
    local experiments without the CSV).
    """
    message = (
        f"query_data dataset unusable ({reason}) at {_csv_path}. "
        "The demos would silently render a 3-row mock. Ensure the CSV ships "
        "inside the tools/ package (every integration Dockerfile copies it). "
        "Set SHOWCASE_ALLOW_MOCK_DATASET=1 to fall back to mock data on purpose."
    )
    if os.getenv("SHOWCASE_ALLOW_MOCK_DATASET") in ("1", "true", "TRUE"):
        _logger.error("%s — continuing with mock data (opt-in).", message)
        print(f"[query_data] {message}", file=sys.stderr, flush=True)
        return _MOCK_DATA
    raise RuntimeError(message)


try:
    with open(_csv_path) as _f:
        _cached_data: list[dict[str, Any]] = list(csv.DictReader(_f))
    if not _cached_data:
        _cached_data = _fail_or_mock("file is empty")
except (FileNotFoundError, OSError) as exc:
    _cached_data = _fail_or_mock(str(exc))


def query_data_impl(query: str) -> list[dict[str, Any]]:
    """Query the database. Takes natural language.

    Always call before showing a chart or graph. Returns the full
    dataset as a list of dicts (rows from the CSV).
    """
    return _cached_data
