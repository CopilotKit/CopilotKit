"""Reproduce / verify issue 006 — does the agent successfully populate the
canvas after asking it to import the workshop leads?

Bypasses BFF/UI/CopilotKit. Drives the compiled LangGraph directly with a
text-only user message and prints every tool call + the final canvas state.

Verdict logic:
- PASS: fetch_notion_leads ran AND the final state has `leads` populated.
  This is what the new Command(update=) path produces — the rows reach
  state without the agent having to construct setLeads(rows=[…]) as
  tool-call output.
- FAIL: any other outcome.

Usage: cd agent && uv run python scripts/repro_006.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from langchain_core.messages import HumanMessage

import main as agent_main


PROMPT = "Import the workshop leads from Notion."

TURN_BUDGET_S = 90


async def run() -> int:
    graph = agent_main.graph
    print(f"[repro] runtime={os.getenv('AGENT_RUNTIME', 'gemini-3-pro-deep')}")
    print(f"[repro] prompt={PROMPT!r}")
    print(f"[repro] streaming events…")

    started = time.perf_counter()
    tool_calls: list[str] = []
    final_state: dict = {}

    try:
        async for event in graph.astream(
            {"messages": [HumanMessage(content=PROMPT)]},
            config={"configurable": {"thread_id": "repro-006"}},
            stream_mode="updates",
        ):
            elapsed = time.perf_counter() - started
            if elapsed > TURN_BUDGET_S:
                print(f"[repro] HARD CUTOFF at {elapsed:.1f}s — loop suspected")
                break

            for node, payload in event.items():
                if not isinstance(payload, dict):
                    continue

                # Track final state shape for verdict
                for key in ("leads", "view", "header", "sync"):
                    if key in payload:
                        final_state[key] = payload[key]

                msgs = payload.get("messages", [])
                for m in msgs:
                    role = type(m).__name__
                    tcalls = getattr(m, "tool_calls", None) or []
                    if tcalls:
                        for tc in tcalls:
                            name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "?")
                            tool_calls.append(name)
                            print(f"  [{elapsed:6.2f}s] {node} -> {role} tool_call={name}")
                    else:
                        content = (getattr(m, "content", "") or "")
                        if isinstance(content, list):
                            content = " ".join(
                                (b.get("text", "") if isinstance(b, dict) else str(b))
                                for b in content
                            )
                        snippet = content[:200].replace("\n", " ")
                        if snippet:
                            print(f"  [{elapsed:6.2f}s] {node} -> {role} text={snippet!r}")
    except Exception as exc:
        print(f"[repro] EXCEPTION: {type(exc).__name__}: {exc}")

    total = time.perf_counter() - started
    leads = final_state.get("leads") or []
    view = final_state.get("view")
    header = final_state.get("header")
    sync = final_state.get("sync")

    print()
    print(f"[repro] total={total:.2f}s tool_calls={tool_calls}")
    print(f"[repro] final state:")
    print(f"  leads count = {len(leads)}")
    print(f"  view        = {view!r}")
    print(f"  header      = {header}")
    print(f"  sync        = {sync}")
    print(f"[repro] verdict:")

    fetch_called = any("fetch_notion_leads" in t for t in tool_calls)
    leads_populated = len(leads) > 0

    if fetch_called and leads_populated:
        print(f"  PASS — fetch ran and state.leads={len(leads)} populated")
        return 0
    if fetch_called and not leads_populated:
        print("  FAIL — fetch ran but state.leads is empty (Command update did not flow)")
        return 1
    if not fetch_called:
        print("  FAIL — fetch_notion_leads was never called")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
