"""Test support — purge one user's durable memory so the cross-session E2E tests
are deterministic regardless of prior runs.

Memory extraction is an LLM step: with many similar facts accumulated under the
shared demo user, it can conflate them (e.g. pair this run's unique key with an
older run's value), which makes recall non-deterministic. Clearing the user's
records before the suite removes that pollution.

`oracleagentmemory` keys its records by USER_ID, so a scoped DELETE across its
tables is a clean, well-defined purge (the VECTOR$ index on RECORD_CHUNKS
self-maintains on DML). Run automatically from `global-setup.ts`.

Usage:  python reset-memory.py [user_id]   (default: demo-user)
Needs ORACLE_DB_* in the agent's .env; run via the agent venv (`uv run`).
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

# The agent's .env (…/<project>/agent/.env) is not an ancestor of this script, so
# point python-dotenv at it explicitly rather than relying on its search path.
_AGENT_ENV = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", ".env"
)
load_dotenv(_AGENT_ENV)

USER = sys.argv[1] if len(sys.argv) > 1 else "demo-user"
# Children first; the VECTOR$ index on RECORD_CHUNKS auto-maintains on delete.
TABLES = ("RECORD_CHUNKS", "MEMORY", "MESSAGE", "THREAD")

try:
    import oracledb

    conn = oracledb.connect(
        user=os.environ["ORACLE_DB_USER"],
        password=os.environ["ORACLE_DB_PASSWORD"],
        dsn=os.environ["ORACLE_DB_DSN"],
    )
except Exception as exc:  # DB down / not provisioned — let the tests surface it
    print(f"[reset-memory] skipped: cannot connect ({exc})")
    sys.exit(0)

cur = conn.cursor()
deleted: dict[str, object] = {}
for table in TABLES:
    try:
        cur.execute(f'DELETE FROM "{table}" WHERE USER_ID = :1', [USER])
        deleted[table] = cur.rowcount
    except Exception as exc:
        # ORA-00942 (table not created yet) on a fresh database is fine.
        deleted[table] = f"skip ({type(exc).__name__})"
conn.commit()
conn.close()
print(f"[reset-memory] cleared {USER!r}: {deleted}")
