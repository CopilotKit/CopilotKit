"""Build and cache the OracleAgentMemory client."""

from __future__ import annotations

import functools
import os

import oracledb
from oracleagentmemory.core import OracleAgentMemory
from oracleagentmemory.core.embedders.embedder import Embedder
from oracleagentmemory.core.llms.llm import Llm


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable {name!r}. "
            "Copy agent/.env.example to agent/.env and fill it in."
        )
    return value


@functools.lru_cache(maxsize=1)
def get_memory() -> OracleAgentMemory:
    """Return a process-wide singleton memory client (lazily constructed)."""
    pool = oracledb.create_pool(
        user=_require("ORACLE_DB_USER"),
        password=_require("ORACLE_DB_PASSWORD"),
        dsn=_require("ORACLE_DB_DSN"),  # e.g. "localhost:1521/FREEPDB1"
        min=1,
        max=4,
        increment=1,
    )
    embedder = Embedder(model=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"))
    llm = Llm(model=os.getenv("MEMORY_LLM_MODEL", "gpt-5.4-mini"))
    # schema_policy="create_if_necessary" provisions the memory tables on first
    # run (the cookbook DB user has DB_DEVELOPER_ROLE). Without it, OracleAgentMemory
    # errors on a fresh database with "Managed DB schema is missing required objects".
    return OracleAgentMemory(
        connection=pool,
        embedder=embedder,
        llm=llm,
        schema_policy="create_if_necessary",
    )
