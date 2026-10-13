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
        assert isinstance(row["amount"], str), (
            f"amount should be str, got {type(row['amount'])}"
        )


def test_mock_data_shape():
    """The opt-in mock rows keep the same columns and types as the CSV."""
    from tools.query_data import _MOCK_DATA

    assert len(_MOCK_DATA) == 3
    for row in _MOCK_DATA:
        assert "date" in row
        assert "category" in row
        assert "notes" in row
        assert isinstance(row["amount"], str)


def test_loads_shipped_dataset_not_mock():
    """The CSV inside tools/ is loaded, so the demos never see the 3-row mock."""
    from tools import query_data

    assert query_data._csv_path.is_file()
    assert query_data._cached_data is not query_data._MOCK_DATA
    assert len(query_data._cached_data) > len(query_data._MOCK_DATA)


def test_missing_dataset_raises_without_opt_in(monkeypatch):
    from tools.query_data import _fail_or_mock

    monkeypatch.delenv("SHOWCASE_ALLOW_MOCK_DATASET", raising=False)
    with pytest.raises(RuntimeError, match="SHOWCASE_ALLOW_MOCK_DATASET"):
        _fail_or_mock("file is empty")


@pytest.mark.parametrize("value", ["", "0", "false", "yes"])
def test_missing_dataset_raises_for_other_values(monkeypatch, value):
    from tools.query_data import _fail_or_mock

    monkeypatch.setenv("SHOWCASE_ALLOW_MOCK_DATASET", value)
    with pytest.raises(RuntimeError):
        _fail_or_mock("file is empty")


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "True", " true "])
def test_missing_dataset_returns_mock_with_opt_in(monkeypatch, value):
    from tools.query_data import _MOCK_DATA, _fail_or_mock

    monkeypatch.setenv("SHOWCASE_ALLOW_MOCK_DATASET", value)
    assert _fail_or_mock("file is empty") is _MOCK_DATA
