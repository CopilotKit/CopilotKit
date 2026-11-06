# patterns/langgraph-single-agent/tools/query_data.py
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import csv
from pathlib import Path

from langchain.tools import tool

# Read at module load time — avoids file I/O on every tool invocation.
_csv_path = Path(__file__).parent / "db.csv"
try:
    with open(_csv_path) as _f:
        _cached_data = list(csv.DictReader(_f))
except (FileNotFoundError, OSError) as e:
    raise RuntimeError(f"query_data: cannot load sample data from {_csv_path}") from e


@tool
def query_data(query: str) -> list[dict]:
    """
    Query the database. Accepts natural language.
    Always call this tool before displaying a chart or graph.
    """
    return _cached_data
