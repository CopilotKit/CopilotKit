"""Deterministic mock stock data for showcase tool renderers."""


def get_stock_price_impl(ticker: str) -> dict[str, str | float]:
    """Return the gold headless demo's mock quote with an uppercase ticker."""
    return {
        "ticker": ticker.upper(),
        "price_usd": 189.42,
        "change_pct": 1.27,
    }
