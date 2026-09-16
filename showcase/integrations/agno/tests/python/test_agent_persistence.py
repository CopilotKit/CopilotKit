"""Regression coverage for Agno frontend-tool session persistence."""

from pathlib import Path

from agents.main import agent
from agno.db.sqlite import SqliteDb


def test_showcase_agent_has_sqlite_session_storage():
    assert isinstance(agent.db, SqliteDb)
    assert Path(agent.db.db_file).resolve() == Path("/tmp/agno.db").resolve()
