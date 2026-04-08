"""Finance ERP agent — orchestrator with thread-isolated research & projections tools."""

from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

import json
from typing import Any

from langchain_openai import ChatOpenAI
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from copilotkit import CopilotKitMiddleware

from frontend_tools import frontend_tools
from isolated_subagents import do_research, do_projections
from prompts import ORCHESTRATOR_PROMPT


class _PydanticEncoder(json.JSONEncoder):
    """JSON encoder that handles Pydantic models (e.g. ag_ui Context objects)."""

    def default(self, o: Any) -> Any:
        if hasattr(o, "model_dump"):
            return o.model_dump()
        return super().default(o)


# Monkey-patch the middleware's before_agent to use the Pydantic-aware encoder.
# This works around a bug in copilotkit 0.1.83 where ag_ui Context objects
# are not JSON-serializable.
_original_before_agent = CopilotKitMiddleware.before_agent


def _patched_before_agent(self: Any, state: Any, runtime: Any) -> Any:
    _orig_dumps = json.dumps
    json.dumps = lambda *a, **kw: _orig_dumps(*a, cls=_PydanticEncoder, **{k: v for k, v in kw.items() if k != "cls"})
    try:
        return _original_before_agent(self, state, runtime)
    finally:
        json.dumps = _orig_dumps


CopilotKitMiddleware.before_agent = _patched_before_agent


# ---------------------------------------------------------------------------
# Agent builder
# ---------------------------------------------------------------------------


def build_agent():
    """Build the Finance ERP orchestrator with thread-isolated subagent tools."""
    llm = ChatOpenAI(
        model=os.environ.get("OPENAI_MODEL", "gpt-5.4-2026-03-05"),
        temperature=0,
        streaming=True,
    )

    checkpointer = MemorySaver()

    agent = create_deep_agent(
        model=llm,
        tools=[*frontend_tools, do_research, do_projections],
        system_prompt=ORCHESTRATOR_PROMPT,
        middleware=[CopilotKitMiddleware()],
        checkpointer=checkpointer,
    )

    return agent


finance_erp_graph = build_agent()
