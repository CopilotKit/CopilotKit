"""Wipe a user's stored memories for a clean demo slate.

Usage (from the agent/ dir):
    uv run python scripts/reset_memory.py            # resets demo-user
    uv run python scripts/reset_memory.py some-user

`oracleagentmemory` keys its records by USER_ID, so a scoped DELETE across its
tables is a clean, deterministic purge (the VECTOR$ index on RECORD_CHUNKS
self-maintains on DML) — more reliable than deleting search hits one by one, which
can miss records the ranked search never returns. The agent re-creates preferences
on the next conversation. Safe to run repeatedly.
"""

from __future__ import annotations

import os
import sys

import oracledb
from dotenv import load_dotenv

load_dotenv()

# Children first; the VECTOR$ index on RECORD_CHUNKS auto-maintains on delete.
_TABLES = ("RECORD_CHUNKS", "MEMORY", "MESSAGE", "THREAD")


def reset(user_id: str) -> dict[str, object]:
    conn = oracledb.connect(
        user=os.environ["ORACLE_DB_USER"],
        password=os.environ["ORACLE_DB_PASSWORD"],
        dsn=os.environ["ORACLE_DB_DSN"],
    )
    cur = conn.cursor()
    deleted: dict[str, object] = {}
    for table in _TABLES:
        try:
            cur.execute(f'DELETE FROM "{table}" WHERE USER_ID = :1', [user_id])
            deleted[table] = cur.rowcount
        except Exception as exc:  # ORA-00942 on a fresh DB (table not created) is fine
            deleted[table] = f"skip ({type(exc).__name__})"
    conn.commit()
    conn.close()
    return deleted


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "demo-user"
    result = reset(target)
    print(f"Reset complete for user {target!r}: {result}")
