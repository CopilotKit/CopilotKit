"""Soft-delete orphan chat threads on agent boot.

Why this exists
---------------
`langgraph dev` runs the agent with an **in-memory** checkpoint store
(`langgraph-runtime-inmem`). There is no Postgres-backed runtime extra
for the open-source CLI — `langgraph up` (Docker) is the only persistent
option. So whenever the agent process restarts (hot reload, manual
restart, crash), the entire LangGraph thread/checkpoint state is wiped.

CopilotKit's chat history, on the other hand, persists in the
Intelligence Postgres on :5436. After an agent restart, that table still
contains threads whose message IDs no longer resolve to any checkpoint,
and the next send through `@ag-ui/langgraph`'s `getCheckpointByMessage`
throws `Error("Message not found")` — the user sees an opaque rxjs
stack trace.

Cheapest defensible fix: on agent boot, soft-delete any active threads
that target this agent (`agent_id = 'default'`). They are guaranteed
orphans because the in-memory store is empty at process start. The
threads drawer filters by `deleted_at IS NULL`, so the user sees a
clean slate and the runtime never tries to walk the dead history.

This is a dev-only fix. In production you'd run `langgraph up` (or a
custom FastAPI server with `AsyncPostgresSaver`) so checkpoints
actually persist — see Phase 06 follow-up.
"""

from __future__ import annotations

import os


# The BFF identifies its agent as "default" (see bff/src/server.ts
# `agents: { default: agent }`). The other agent_ids in the dev seed
# (`beamAgent`, `lambdaAgent`, `camlAgent`) belong to demo users and
# must NOT be wiped.
AGENT_ID = "default"


def _connection_string() -> str:
    """Build the Intelligence Postgres DSN.

    Credentials match `docker-compose.yml`. Host port is read from env
    so the v2/v2a port-remap stays consistent with the rest of the kit
    (v2a uses 5436, v2 uses 5433).
    """
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_HOST_PORT", "5436")
    user = os.getenv("POSTGRES_USER", "intelligence")
    pwd = os.getenv("POSTGRES_PASSWORD", "intelligence")
    db = os.getenv("INTELLIGENCE_DATABASE", "intelligence_app")
    return f"postgresql://{user}:{pwd}@{host}:{port}/{db}"


def wipe_orphan_threads(*, agent_id: str = AGENT_ID) -> None:
    """Soft-delete every active thread for `agent_id`.

    Idempotent — if there are no active threads it's a no-op. Failures
    (Postgres down, missing schema, auth) are logged at WARN and
    swallowed so the agent always boots.

    The CHECK constraint on `cpki.threads` requires that the three
    delete-marker columns are either all NULL or all non-NULL, so the
    UPDATE sets all three.
    """
    try:
        # Lazy import: psycopg is only needed for this cleanup; if it's
        # missing we surface a clear pointer instead of breaking boot.
        import psycopg  # type: ignore[import-not-found]
    except ImportError:
        print(
            "[intelligence_cleanup] psycopg not installed — "
            "stale-thread cleanup skipped. Run `uv sync` in agent/.",
            flush=True,
        )
        return

    dsn = _connection_string()
    try:
        with psycopg.connect(dsn, connect_timeout=2) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE cpki.threads
                       SET deleted_at = NOW(),
                           deleted_by = %s,
                           deleted_reason = %s
                     WHERE deleted_at IS NULL
                       AND agent_id = %s
                    """,
                    (
                        "agent-boot",
                        "in-memory checkpoint store reset on agent boot",
                        agent_id,
                    ),
                )
                affected = cur.rowcount
        if affected:
            print(
                f"[intelligence_cleanup] soft-deleted {affected} orphan "
                f'thread(s) for agent_id="{agent_id}"',
                flush=True,
            )
        else:
            print(
                f"[intelligence_cleanup] no orphan threads to clean "
                f'(agent_id="{agent_id}")',
                flush=True,
            )
    except Exception as e:  # noqa: BLE001 — never block boot
        # Most common cause: Intelligence Postgres isn't running yet.
        # That's fine — the user will hit a different (more obvious)
        # error first ("Failed to initialize thread") and the BFF
        # already remaps that to a setup pointer.
        print(
            f"[intelligence_cleanup] skipped: {type(e).__name__}: {e}",
            flush=True,
        )
