"""Oracle checkpointer durability round-trip test.

Verifies that LangGraph state written through AsyncOracleSaver actually
persists in Oracle so that a *fresh* saver (simulating a process restart)
can read the same thread back from the DB.

Skipped unless ``LANGGRAPH_CHECKPOINTER=oracle`` is set in the environment —
requires a live Oracle DB with the env vars ``ORACLE_DB_USER``,
``ORACLE_DB_PASSWORD``, and ``ORACLE_DB_DSN`` present.
"""

from __future__ import annotations

import os
import time

import pytest
from dotenv import load_dotenv

# Module-level skip: entire file is skipped unless Oracle is selected.
pytestmark = pytest.mark.skipif(
    os.getenv("LANGGRAPH_CHECKPOINTER", "memory").lower() != "oracle",
    reason="requires LANGGRAPH_CHECKPOINTER=oracle + a live Oracle DB",
)


async def test_checkpoint_survives_fresh_saver() -> None:
    """State written through saver1 must be readable through saver2 (same DB).

    This proves durability: the checkpoint lives in Oracle, not in-process RAM.
    """
    import oracledb
    from langchain_core.messages import AIMessage, HumanMessage
    from langgraph.graph import END, START, MessagesState, StateGraph
    from langgraph_oracledb.checkpoint.oracle import AsyncOracleSaver

    # Load .env so credentials are available when running from the agent dir.
    load_dotenv()

    def _require(name: str) -> str:
        value = os.getenv(name)
        if not value:
            raise RuntimeError(
                f"Missing required environment variable {name!r}. "
                "Copy agent/.env.example to agent/.env and fill it in."
            )
        return value

    user = _require("ORACLE_DB_USER")
    password = _require("ORACLE_DB_PASSWORD")
    dsn = _require("ORACLE_DB_DSN")

    # Use a unique thread_id so parallel/repeated test runs don't clash.
    thread_id = f"verify-{int(time.time())}"
    config = {"configurable": {"thread_id": thread_id}}

    # ── Trivial graph definition (reused for both compilations) ──────────────
    def _build_graph(checkpointer):
        def probe_node(state: MessagesState):
            return {"messages": [AIMessage(content="durability-probe")]}

        sg = StateGraph(MessagesState)
        sg.add_node("probe", probe_node)
        sg.add_edge(START, "probe")
        sg.add_edge("probe", END)
        return sg.compile(checkpointer=checkpointer)

    pool1 = None
    pool2 = None
    try:
        # ── Phase 1: write a checkpoint via saver1 ───────────────────────────
        pool1 = oracledb.create_pool_async(
            user=user,
            password=password,
            dsn=dsn,
            min=1,
            max=4,
            increment=1,
        )
        saver1 = AsyncOracleSaver(pool1)
        await saver1.setup()

        graph1 = _build_graph(saver1)
        async for _ in graph1.astream(
            {"messages": [HumanMessage(content="hi")]}, config
        ):
            pass

        # ── Phase 2: read it back via saver2 (fresh saver, same DB) ─────────
        pool2 = oracledb.create_pool_async(
            user=user,
            password=password,
            dsn=dsn,
            min=1,
            max=4,
            increment=1,
        )
        saver2 = AsyncOracleSaver(pool2)
        # No setup() needed to read; tables already exist.

        graph2 = _build_graph(saver2)
        state = await graph2.aget_state(config)

        # Collect all message contents for assertion.
        messages = state.values.get("messages", [])
        contents = [getattr(m, "content", "") for m in messages]

        assert any(
            "durability-probe" in c for c in contents
        ), f"Expected 'durability-probe' in messages, got: {contents}"

        assert any(
            "hi" in c for c in contents
        ), f"Expected HumanMessage 'hi' in messages, got: {contents}"

    finally:
        if pool1 is not None:
            await pool1.close()
        if pool2 is not None:
            await pool2.close()
