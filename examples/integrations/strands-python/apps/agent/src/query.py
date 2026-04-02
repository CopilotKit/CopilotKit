import csv
import json
from pathlib import Path

from strands import tool

# Read data at module load time
_csv_path = Path(__file__).parent / "db.csv"
with open(_csv_path) as _f:
    _cached_data = list(csv.DictReader(_f))


@tool
def query_data(query: str) -> str:
    """Query the database, takes natural language. Always call before showing a chart or graph.

    Args:
        query: A natural language query describing the data to fetch
    """
    return json.dumps(_cached_data)
