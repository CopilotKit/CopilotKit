"""Flag-gated LangGraph checkpointer for durable Oracle graph state.

Resolves the LangGraph checkpointer based on the ``LANGGRAPH_CHECKPOINTER``
environment variable.  When set to ``oracle``, builds a dedicated async Oracle
connection pool and an ``AsyncOracleSaver`` (durable graph-state persistence
that complements OracleAgentMemory for conversation history).  Any other value
— or the default when the variable is absent — falls back to an in-memory
``MemorySaver`` so the agent works without a database.

Usage::

    await init_checkpointer()          # call once at startup
    checkpointer = resolve_checkpointer()  # call per LangGraph graph build
    ...
    await close_checkpointer()         # call once at shutdown
"""

from __future__ import annotations

import os

import oracledb
from langgraph.checkpoint.memory import MemorySaver
from langgraph_oracledb.checkpoint.oracle import AsyncOracleSaver

# ---------------------------------------------------------------------------
# Module-level globals – populated by init_checkpointer()
# ---------------------------------------------------------------------------
_pool = None
_saver = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable {name!r}. "
            "Copy agent/.env.example to agent/.env and fill it in."
        )
    return value


def _flag() -> str:
    return os.getenv("LANGGRAPH_CHECKPOINTER", "memory").lower()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def init_checkpointer() -> None:
    """Initialise the Oracle async pool + AsyncOracleSaver when the flag is set.

    Safe to call at startup unconditionally — exits immediately when the flag
    is not ``oracle``.  On any failure the module degrades gracefully to the
    in-memory saver rather than crashing the server.
    """
    global _pool, _saver

    if _flag() != "oracle":
        return

    try:
        _pool = oracledb.create_pool_async(
            user=_require("ORACLE_DB_USER"),
            password=_require("ORACLE_DB_PASSWORD"),
            dsn=_require("ORACLE_DB_DSN"),
            min=1,
            max=4,
            increment=1,
        )
        _saver = AsyncOracleSaver(_pool)
        await _saver.setup()
    except Exception as exc:
        print(f"[checkpointer] warning: Oracle checkpointer init failed — degrading to MemorySaver ({exc})")
        _pool = None
        _saver = None


async def close_checkpointer() -> None:
    """Close the async Oracle pool and reset the module globals.

    Safe to call unconditionally at shutdown (no-op when the pool was never
    opened or already closed).
    """
    global _pool, _saver

    if _pool is not None:
        await _pool.close()
        _pool = None
        _saver = None


def resolve_checkpointer():
    """Return the active checkpointer for use in a LangGraph graph build.

    Returns the ``AsyncOracleSaver`` when the flag is ``oracle`` AND the saver
    was successfully initialised; otherwise returns a fresh ``MemorySaver()``.
    """
    if _flag() == "oracle" and _saver is not None:
        return _saver
    return MemorySaver()
