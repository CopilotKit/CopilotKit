"""query_data tool — returns rows from the sample financial database."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool

# Read the CSV once at import. The notes column can contain unquoted commas, so
# keep the first N-1 fields and join the remainder into the last column.
_CSV_PATH = Path(__file__).parent / "db.csv"
with open(_CSV_PATH, newline="") as _f:
    _reader = csv.reader(_f)
    _header = next(_reader)
    _last = len(_header) - 1
    _CACHED_DATA = [
        {
            **{_header[i]: (row[i] if i < len(row) else "") for i in range(_last)},
            _header[_last]: ",".join(row[_last:]),
        }
        for row in _reader
        if row
    ]


@tool(
    "query_data",
    "Query the financial database with a natural-language query. Always call "
    "this before rendering a chart so the UI has data to plot.",
    {"query": str},
)
async def query_data(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(_CACHED_DATA)}]}
