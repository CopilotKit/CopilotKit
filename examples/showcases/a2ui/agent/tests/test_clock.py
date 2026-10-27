from datetime import datetime, timezone

from research_desk.clock import TIME_ZONE_CONTEXT, reader_now

NOON_UTC = datetime(2026, 10, 26, 16, 45, tzinfo=timezone.utc)


def test_the_readers_local_date_and_time():
    entries = [{"description": TIME_ZONE_CONTEXT, "value": "America/Chicago"}]
    line = reader_now(entries, NOON_UTC)
    assert "Monday, October 26, 2026, 11:45 AM" in line
    assert "America/Chicago, UTC-05:00" in line


def test_a_date_line_in_utc_without_a_time_zone():
    assert "4:45 PM for the reader (UTC, UTC+00:00)" in reader_now([], NOON_UTC)
    unknown = [{"description": TIME_ZONE_CONTEXT, "value": "Mars/Olympus"}]
    assert "(UTC, UTC+00:00)" in reader_now(unknown, NOON_UTC)


def test_the_date_crosses_midnight_with_the_reader():
    entries = [{"description": TIME_ZONE_CONTEXT, "value": "Asia/Tokyo"}]
    assert "Tuesday, October 27, 2026, 1:45 AM" in reader_now(entries, NOON_UTC)
