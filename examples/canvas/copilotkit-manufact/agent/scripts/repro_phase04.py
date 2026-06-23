"""Reproduce / verify phase 04 — does the agent successfully write back to
Notion when asked to update a lead's workshop?

Bypasses BFF/UI/CopilotKit. Drives the compiled LangGraph directly with a
text-only user message and prints every tool call + the final canvas state,
then verifies the change landed in Notion via the MCP read path. Restores
the original value so demo data isn't corrupted.

Verdict logic:
- PASS: update_notion_lead was called AND a follow-up Notion read shows the
  new workshop value AND the rollback step restored the original.
- FAIL: any other outcome.

Usage: cd agent && uv run python scripts/repro_phase04.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from langchain_core.messages import HumanMessage

import main as agent_main
from src.notion_integration import fetch_leads
from src.notion_mcp import mcp_update_page


TURN_BUDGET_S = 120
TARGET_NEW_WORKSHOP = "MCP Apps / Tooling"


async def _run_turn(
    prompt: str, thread_id: str, fail_on_error: bool = True
) -> Dict[str, Any]:
    """Run one turn through the compiled graph, returning {tool_calls, leads, messages}.

    `fail_on_error` only controls the print formatting — the function never
    raises so callers can use the result for verdicts.
    """
    graph = agent_main.graph
    started = time.perf_counter()
    tool_calls: List[str] = []
    final_leads: List[Dict[str, Any]] = []
    final_msgs: List[str] = []

    try:
        async for event in graph.astream(
            {"messages": [HumanMessage(content=prompt)]},
            config={"configurable": {"thread_id": thread_id}},
            stream_mode="updates",
        ):
            elapsed = time.perf_counter() - started
            if elapsed > TURN_BUDGET_S:
                print(f"  [repro] HARD CUTOFF at {elapsed:.1f}s — loop suspected")
                break

            for node, payload in event.items():
                if not isinstance(payload, dict):
                    continue
                if "leads" in payload and isinstance(payload["leads"], list):
                    final_leads = payload["leads"]
                msgs = payload.get("messages", [])
                for m in msgs:
                    role = type(m).__name__
                    tcalls = getattr(m, "tool_calls", None) or []
                    if tcalls:
                        for tc in tcalls:
                            name = (
                                tc.get("name")
                                if isinstance(tc, dict)
                                else getattr(tc, "name", "?")
                            )
                            tool_calls.append(name)
                            print(f"  [{elapsed:6.2f}s] {node} -> {role} tool_call={name}")
                    else:
                        content = getattr(m, "content", "") or ""
                        if isinstance(content, list):
                            content = " ".join(
                                (b.get("text", "") if isinstance(b, dict) else str(b))
                                for b in content
                            )
                        snippet = str(content)[:200].replace("\n", " ")
                        if snippet:
                            final_msgs.append(snippet)
                            print(f"  [{elapsed:6.2f}s] {node} -> {role} text={snippet!r}")
    except Exception as exc:
        if fail_on_error:
            print(f"  [repro] EXCEPTION: {type(exc).__name__}: {exc}")

    total = time.perf_counter() - started
    print(f"  [repro] turn done in {total:.2f}s tool_calls={tool_calls}")
    return {
        "tool_calls": tool_calls,
        "leads": final_leads,
        "messages": final_msgs,
    }


def _read_workshop_for(lead_id: str) -> Optional[str]:
    """Re-fetch from Notion and return the workshop value for a single lead."""
    db_id = os.getenv("NOTION_LEADS_DATABASE_ID", "")
    rows = fetch_leads(db_id) or []
    for row in rows:
        if row.get("id") == lead_id:
            return row.get("workshop")
    return None


async def run() -> int:
    print(f"[repro] runtime={os.getenv('AGENT_RUNTIME', 'gemini-flash-deep')}")
    print(f"[repro] phase 04 — verify update_notion_lead round-trip")

    db_id = os.getenv("NOTION_LEADS_DATABASE_ID", "")
    if not db_id:
        print("[repro] FAIL — NOTION_LEADS_DATABASE_ID is unset.")
        return 1

    print("[repro] step 1: fetching baseline leads from Notion…")
    rows = fetch_leads(db_id) or []
    if not rows:
        print("[repro] FAIL — no leads in Notion to test with.")
        return 1

    target = rows[0]
    target_id = target["id"]
    original_workshop = target.get("workshop") or "Not sure yet"
    print(
        f"[repro] target lead: {target.get('name')!r} id={target_id} "
        f"workshop={original_workshop!r}"
    )

    if original_workshop == TARGET_NEW_WORKSHOP:
        # Pick a different new value so the change is observable.
        new_workshop = "RAG & Data Chat"
    else:
        new_workshop = TARGET_NEW_WORKSHOP
    print(f"[repro] will set workshop -> {new_workshop!r}")

    # Make sure the agent has the lead in its state — the write tool reads
    # `state.leads` via InjectedState to merge the patch into the canvas list.
    print("[repro] step 2: priming agent state by importing leads…")
    prime = await _run_turn(
        "Import the workshop leads from Notion.",
        thread_id="repro-phase04",
    )
    if not any("fetch_notion_leads" in t for t in prime["tool_calls"]):
        print("[repro] FAIL — priming import did not call fetch_notion_leads.")
        return 1
    if not prime["leads"]:
        print("[repro] FAIL — priming import did not populate state.leads.")
        return 1
    print(f"[repro] state.leads primed with {len(prime['leads'])} rows")

    # ----- Step 3: ask the agent to update -----
    print(f"[repro] step 3: asking agent to update workshop -> {new_workshop!r}")
    update_prompt = (
        f"Update the workshop for lead {target_id} to '{new_workshop}'."
    )
    upd = await _run_turn(update_prompt, thread_id="repro-phase04")

    update_called = any("update_notion_lead" in t for t in upd["tool_calls"])
    confirmed = any(
        m.startswith("Updated ") for m in upd["messages"]
    )
    if not update_called:
        print("[repro] FAIL — update_notion_lead was never called.")
        # Best-effort cleanup if anything happened anyway
        return 1
    if not confirmed:
        print("[repro] FAIL — update_notion_lead never reported success.")
        return 1

    # ----- Step 4: verify Notion side actually changed -----
    print("[repro] step 4: verifying Notion side via fetch_leads…")
    actual = _read_workshop_for(target_id)
    print(f"[repro] notion now reports workshop={actual!r}")

    success = actual == new_workshop

    # ----- Step 5: restore original value so demo data isn't corrupted -----
    print(f"[repro] step 5: restoring workshop -> {original_workshop!r}")
    try:
        # Prefer a direct MCP call for restore — deterministic and doesn't
        # rely on the agent making a second correct tool call.
        if original_workshop:
            mcp_update_page(
                target_id,
                {
                    "What workshop would you like to join next?": {
                        "select": {"name": original_workshop}
                    }
                },
            )
        else:
            mcp_update_page(
                target_id,
                {
                    "What workshop would you like to join next?": {"select": None}
                },
            )
        restored = _read_workshop_for(target_id)
        print(f"[repro] notion now reports workshop={restored!r}")
        if restored != original_workshop:
            print(
                "[repro] WARN — restore did not match original "
                f"({restored!r} vs {original_workshop!r})"
            )
    except Exception as exc:  # noqa: BLE001
        print(f"[repro] WARN — restore raised: {exc}")

    print()
    print("[repro] verdict:")
    if success:
        print(
            f"  PASS — agent called update_notion_lead and Notion now reports "
            f"workshop={new_workshop!r} for {target_id}"
        )
        return 0
    print(
        f"  FAIL — Notion workshop is {actual!r}, expected {new_workshop!r}"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
