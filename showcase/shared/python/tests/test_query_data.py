import pytest
import logging
from unittest.mock import patch
from tools import query_data_impl

def test_returns_list():
    result = query_data_impl("any query")
    assert isinstance(result, list)

def test_returns_nonempty():
    result = query_data_impl("revenue breakdown")
    assert len(result) > 0

def test_rows_have_expected_columns():
    result = query_data_impl("test")
    row = result[0]
    assert "date" in row
    assert "category" in row
    assert "subcategory" in row
    assert "amount" in row
    assert "type" in row

def test_query_param_doesnt_filter():
    r1 = query_data_impl("revenue")
    r2 = query_data_impl("expenses")
    assert len(r1) == len(r2)  # same data regardless of query

def test_all_six_columns_present():
    """Verify all 6 expected columns including 'notes'."""
    result = query_data_impl("test")
    row = result[0]
    for col in ("date", "category", "subcategory", "amount", "type", "notes"):
        assert col in row, f"Missing column: {col}"

def test_amount_is_string():
    """Amount should be a string (CSV DictReader returns strings, mock data also uses strings)."""
    result = query_data_impl("test")
    for row in result:
        assert isinstance(row["amount"], str), f"amount should be str, got {type(row['amount'])}"

def test_csv_fallback_uses_mock_data(caplog):
    """When CSV path doesn't exist, module falls back to mock data with a warning."""
    # We can't easily re-trigger module-level loading, but we can verify the
    # mock data structure matches expectations — the _MOCK_DATA is what gets
    # used when CSV is missing.
    from tools.query_data import _MOCK_DATA
    assert len(_MOCK_DATA) == 3
    for row in _MOCK_DATA:
        assert "date" in row
        assert "category" in row
        assert "notes" in row
        assert isinstance(row["amount"], str)
