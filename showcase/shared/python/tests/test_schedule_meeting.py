import pytest
from tools import schedule_meeting_impl

def test_returns_pending_status():
    result = schedule_meeting_impl("discuss roadmap")
    assert result["status"] == "pending_approval"

def test_includes_reason():
    result = schedule_meeting_impl("quarterly review")
    assert result["reason"] == "quarterly review"

def test_includes_duration_minutes():
    result = schedule_meeting_impl("sync", 45)
    assert result["duration_minutes"] == 45

def test_default_duration():
    result = schedule_meeting_impl("sync")
    assert result["duration_minutes"] == 30
