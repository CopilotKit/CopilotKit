"""Test support — block until a just-taught fact is recallable from Oracle.

The Agent Spec memory pipeline is asynchronous: after a turn is persisted, Oracle
Agent Memory extracts, embeds, and indexes it before it can be retrieved. A fact
taught moments ago is therefore not instantly searchable. The cross-session E2E
test must wait for that pipeline before asking in a fresh session — otherwise it
races indexing and recall returns nothing (a flaky failure that looks like a
product bug but is just a too-short delay).

This polls the SAME path `recall_memory` uses (`memory.search`) until the unique
token appears, then exits 0. Including the token in the query makes this a
reliable "is it indexed yet?" probe: the token can only appear in a result once
the fact is stored, so there are no false positives.

Usage:  python wait-until-searchable.py <token> [user_id] [timeout_seconds]
Run via the agent venv:  uv run --directory agent python <this> <token>
"""

from __future__ import annotations

import os
import sys
import time

# This helper lives in frontend/e2e/; the agent (its package + .env + venv deps)
# is two levels up. Put it on the path and load its .env explicitly.
_AGENT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent"
)
sys.path.insert(0, _AGENT_DIR)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(_AGENT_DIR, ".env"))

TOKEN = sys.argv[1] if len(sys.argv) > 1 else ""
USER = sys.argv[2] if len(sys.argv) > 2 else "demo-user"
TIMEOUT = float(sys.argv[3]) if len(sys.argv) > 3 else 120.0
POLL = 3.0

if not TOKEN:
    print("[wait-until-searchable] no token given", file=sys.stderr)
    sys.exit(2)

from concierge.memory import get_memory  # noqa: E402
from oracleagentmemory.apis.searchscope import SearchScope  # noqa: E402

memory = get_memory()
scope = SearchScope(user_id=USER)
query = f"frequent flyer number {TOKEN}"

deadline = time.monotonic() + TIMEOUT
attempt = 0
while time.monotonic() < deadline:
    attempt += 1
    try:
        results = list(memory.search(query=query, scope=scope))
    except Exception as exc:  # transient (index building, pool warm-up) — retry
        print(
            f"[wait-until-searchable] attempt {attempt}: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        results = []
    if any(TOKEN.lower() in (getattr(r, "content", "") or "").lower() for r in results):
        elapsed = int(TIMEOUT - (deadline - time.monotonic()))
        print(f"[wait-until-searchable] {TOKEN!r} searchable after ~{elapsed}s ({attempt} polls)")
        sys.exit(0)
    time.sleep(POLL)

print(f"[wait-until-searchable] {TOKEN!r} NOT searchable within {TIMEOUT:.0f}s", file=sys.stderr)
sys.exit(1)
