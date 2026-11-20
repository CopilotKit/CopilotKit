"""Mock payloads shared by reasoning-chain framework adapters."""

from random import choice, randint


def stock_price_impl(
    ticker: str, price_usd: float | None = None, change_pct: float | None = None
) -> dict:
    return {
        "ticker": ticker.upper(),
        "price_usd": round(float(price_usd), 2)
        if price_usd is not None
        else round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
        "change_pct": round(float(change_pct), 2)
        if change_pct is not None
        else round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
    }


def flight_search_impl(origin: str, destination: str) -> dict:
    return {
        "origin": origin,
        "destination": destination,
        "flights": [
            {
                "airline": "United",
                "flight": "UA231",
                "depart": "08:15",
                "arrive": "16:45",
                "price_usd": 348,
            },
            {
                "airline": "Delta",
                "flight": "DL412",
                "depart": "11:20",
                "arrive": "19:55",
                "price_usd": 312,
            },
            {
                "airline": "JetBlue",
                "flight": "B6722",
                "depart": "17:05",
                "arrive": "01:30",
                "price_usd": 289,
            },
        ],
    }
