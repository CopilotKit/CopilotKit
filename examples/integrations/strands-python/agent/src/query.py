import csv
import json
from pathlib import Path

from strands import tool

# Read data at module load time to avoid file I/O issues in sandboxed
# tool execution environments.
_csv_path = Path(__file__).parent / "db.csv"
with open(_csv_path) as _f:
    _cached_data = list(csv.DictReader(_f))


@tool
def query_data(query: str) -> str:
    """Query the database with a natural-language query.

    Always call this before rendering a chart so the UI has data to plot.
    """
    return json.dumps(_cached_data)