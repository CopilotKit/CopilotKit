"""What day and time it is for the reader.

The model has no clock, and "tomorrow" in a reader's calendar depends on
their time zone. The app sends the browser's time zone as App Context; the
instruction states the reader's local date and time on every model call, so
it is current even late in a long conversation.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Keep in sync with the description the app sends (src/components/Desk.tsx).
TIME_ZONE_CONTEXT = "The reader's time zone"


def _zone(entries: Iterable[dict]) -> tuple[timezone | ZoneInfo, str]:
    name = next(
        (e.get("value") for e in entries if e.get("description") == TIME_ZONE_CONTEXT),
        None,
    )
    if isinstance(name, str) and name:
        try:
            return ZoneInfo(name), name
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return timezone.utc, "UTC"


def reader_now(entries: Iterable[dict], now: Optional[datetime] = None) -> str:
    """One line for the instruction: the reader's current date and time."""
    zone, name = _zone(entries)
    current = (now or datetime.now(timezone.utc)).astimezone(zone)
    offset = current.strftime("%z")
    hour = current.hour % 12 or 12
    return (
        f"Right now it is {current:%A}, {current:%B} {current.day}, {current.year}, "
        f"{hour}:{current:%M} {current:%p} for the reader "
        f"({name}, UTC{offset[:3]}:{offset[3:]}). Use this for today, tomorrow, "
        "this week and every date you work out; never assume another date."
    )
