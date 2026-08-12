"""LLM-driven supersession for durable memories.

Oracle Agent Memory *accumulates* extracted facts; it doesn't retract an old one
when a contradicting newer one arrives. So after a traveler changes a preference
("I now fly from Cebu" after an earlier "I fly from SFO"), both coexist and recall
keeps surfacing the stale value. This pass asks the memory LLM to identify
outdated/duplicate durable facts and deletes them, so the most recent value wins on
the next recall. It runs in the background after each turn and degrades to a no-op
on any error (we never delete unless the LLM names ids from the candidate set).
"""

from __future__ import annotations

import json
import os

from openai import OpenAI
from oracleagentmemory.apis.searchscope import SearchScope

from .memory import get_memory
from .tools import DURABLE_RECORD_TYPES

_SYSTEM_PROMPT = """You curate a traveler's durable travel preferences stored as facts.
You are given a JSON list of facts, each with an "id", a "when" timestamp, and "text".

Mark a fact for deletion when:
- Two or more facts describe the SAME attribute (e.g. home/departure airport, seat
  preference, meal preference) with the same OR conflicting values — keep ONLY the most
  recent (latest "when") and delete the older ones.
- A fact is a near-duplicate of another — keep the most recent, delete the rest.

Never delete facts about DISTINCT attributes. When in doubt, keep it.
Return strict JSON: {"delete_ids": ["<id>", ...]}. Use only ids present in the input."""


def _client() -> OpenAI:
    return OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )


def reconcile_durable_memories(user_id: str) -> int:
    """Delete superseded / duplicate durable memories for ``user_id``.

    Returns the number of records deleted (0 on no-op or any failure).
    """
    memory = get_memory()
    results = memory.search(
        query="traveler durable preferences: home airport, seat, meal, airlines, destinations",
        scope=SearchScope(user_id=user_id),
        record_types=DURABLE_RECORD_TYPES,
        max_results=50,
    )

    facts = []
    for r in results:
        rid = getattr(r, "id", None)
        content = (getattr(r, "content", "") or "").strip()
        if rid and content:
            facts.append({"id": rid, "when": str(getattr(r, "timestamp", "")), "text": content})

    if len(facts) < 2:
        return 0

    valid_ids = {f["id"] for f in facts}
    try:
        resp = _client().chat.completions.create(
            model=os.getenv("MEMORY_LLM_MODEL", "gpt-5.4-mini"),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
            ],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        delete_ids = [i for i in data.get("delete_ids", []) if i in valid_ids]
    except Exception as exc:  # never let reconciliation break persistence
        print(f"[reconcile] skipped (LLM/parse failed: {exc!r})")
        return 0

    deleted = 0
    for rid in delete_ids:
        try:
            deleted += memory.delete_memory(rid)
        except Exception as exc:
            print(f"[reconcile] delete {rid} failed: {exc!r}")
    if deleted:
        print(f"[reconcile] superseded {deleted} stale/duplicate memories for {user_id}")
    return deleted
