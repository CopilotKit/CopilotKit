from pathlib import Path
import csv

_csv_path = Path(__file__).parent / "db.csv"
with open(_csv_path) as _f:
    _cached_data = list(csv.DictReader(_f))


def query_data(query: str):
    """
    Query the database, takes natural language. Always call before showing a chart or graph.
    """
    return _cached_data
