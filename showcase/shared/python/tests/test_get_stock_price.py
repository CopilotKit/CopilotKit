import json

import pytest

import tools
from tools import get_stock_price_impl


@pytest.mark.parametrize(
    "ticker, expected", [("AAPL", "AAPL"), ("aapl", "AAPL"), ("mSfT", "MSFT")]
)
def test_stock_payload_matches_renderer_contract(ticker, expected):
    result = json.loads(json.dumps(get_stock_price_impl(ticker)))
    assert result == {"ticker": expected, "price_usd": 189.42, "change_pct": 1.27}
    assert isinstance(result["price_usd"], (int, float))
    assert isinstance(result["change_pct"], (int, float))


def test_results_do_not_share_mutable_state():
    first = get_stock_price_impl("aapl")
    first["price_usd"] = 0
    assert get_stock_price_impl("aapl")["price_usd"] == 189.42


def test_canonical_barrel_exports_stock_implementation():
    assert "get_stock_price_impl" in tools.__all__
