"""Tests for #3096: copilotkit_interrupt crashes on non-list resume values."""

import pytest
import json
from unittest.mock import patch, MagicMock


class TestInterruptNonListResume:
    """Verify copilotkit_interrupt handles string/dict resume values without crashing."""

    @patch("copilotkit.langgraph.interrupt")
    def test_string_resume_value(self, mock_interrupt):
        """When LangGraph 1.x returns a string resume value, should not crash."""
        mock_interrupt.return_value = "user approved"

        from copilotkit.langgraph import copilotkit_interrupt
        answer, response = copilotkit_interrupt(message="Do you approve?")

        assert answer == "user approved"
        assert response == "user approved"

    @patch("copilotkit.langgraph.interrupt")
    def test_dict_resume_value(self, mock_interrupt):
        """When LangGraph 1.x returns a dict resume value, should return JSON string."""
        mock_interrupt.return_value = {"approved": True, "reason": "looks good"}

        from copilotkit.langgraph import copilotkit_interrupt
        answer, response = copilotkit_interrupt(message="Do you approve?")

        parsed = json.loads(answer)
        assert parsed["approved"] is True
        assert parsed["reason"] == "looks good"

    @patch("copilotkit.langgraph.interrupt")
    def test_list_resume_value_still_works(self, mock_interrupt):
        """Existing behavior: list resume values should still use [-1].content."""
        mock_msg = MagicMock()
        mock_msg.content = "yes"
        mock_interrupt.return_value = [mock_msg]

        from copilotkit.langgraph import copilotkit_interrupt
        answer, response = copilotkit_interrupt(message="Do you approve?")

        assert answer == "yes"
        assert response == [mock_msg]
