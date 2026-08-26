"""Regression coverage for Agno frontend-tool session persistence."""

import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT))
sys.path.insert(0, str(PACKAGE_ROOT / "src"))


def test_showcase_agent_has_sqlite_session_storage():
    from agents.main import agent
    from agno.db.sqlite import SqliteDb

    assert isinstance(agent.db, SqliteDb)
    assert Path(agent.db.db_file).resolve() == Path("/tmp/agno.db").resolve()
