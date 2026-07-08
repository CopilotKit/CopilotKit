"""ServerTool and ClientTool implementations + their Agent Spec declarations and registry.

- recall_memory:   durable, cross-session recall from Oracle Agent Memory (ServerTool).
- search_flights:  mock flight-search tool by destination (ServerTool, canned options).
- book_flight:     client-side booking tool — the UI handles confirmation (ClientTool, HITL).
"""

from __future__ import annotations

import asyncio
import json

from oracleagentmemory.apis.searchscope import SearchScope
from pyagentspec.property import Property
from pyagentspec.tools import ServerTool, ClientTool

from .memory import get_memory

# The adapter drops forwarded_props, so a single-user cookbook defaults here.
# To scope per real user, set this from a ContextVar populated by a FastAPI
# dependency (e.g. an X-User-Id header). See server.py.
DEMO_USER_ID = "demo-user"

# ── Mock flight inventory (keeps the tool runnable without a travel API) ──────
_FLIGHTS = [
    {
        "id": "AMS-001",
        "airline": "KLM",
        "flight_no": "KL606",
        "origin": "SFO",
        "destination": "Amsterdam (AMS)",
        "depart": "2026-07-12T13:25",
        "arrive": "2026-07-13T09:10",
        "duration": "10h 45m",
        "stops": 0,
        "cabin": "Economy",
        "price_usd": 740,
        "notes": "Nonstop · aisle seats available · vegetarian meal on request",
    },
    {
        "id": "AMS-002",
        "airline": "United",
        "flight_no": "UA950",
        "origin": "SFO",
        "destination": "Amsterdam (AMS)",
        "depart": "2026-07-12T15:40",
        "arrive": "2026-07-13T14:05",
        "duration": "13h 25m",
        "stops": 1,
        "cabin": "Economy",
        "price_usd": 612,
        "notes": "1 stop (EWR) · vegetarian meal on request",
    },
    {
        "id": "LIS-010",
        "airline": "TAP Air Portugal",
        "flight_no": "TP238",
        "origin": "SFO",
        "destination": "Lisbon (LIS)",
        "depart": "2026-07-12T16:10",
        "arrive": "2026-07-13T13:30",
        "duration": "12h 20m",
        "stops": 1,
        "cabin": "Economy",
        "price_usd": 690,
        "notes": "1 stop (LIS) · ocean-view layover",
    },
    {
        "id": "TYO-021",
        "airline": "ANA",
        "flight_no": "NH7",
        "origin": "SFO",
        "destination": "Tokyo (HND)",
        "depart": "2026-07-12T11:00",
        "arrive": "2026-07-13T15:35",
        "duration": "11h 35m",
        "stops": 0,
        "cabin": "Economy",
        "price_usd": 1480,
        "notes": "Nonstop · aisle seats available · JR pass add-on",
    },
]


# Durable record types worth recalling. Excludes "message" — the raw chat turns
# (including the agent's own replies like "You usually fly out of SFO…"), which
# otherwise dominate recall and re-assert stale preferences.
DURABLE_RECORD_TYPES = ["preference", "memory", "fact", "guideline"]


def _recall_sync(query: str) -> str:
    try:
        memory = get_memory()
        results = memory.search(
            query=query,
            scope=SearchScope(user_id=DEMO_USER_ID),
            record_types=DURABLE_RECORD_TYPES,
            max_results=20,
        )
        contents: list[str] = []
        seen: set[str] = set()
        for r in results:
            c = (r.content or "").strip()
            if not c or c.lower() in seen:
                continue
            seen.add(c.lower())
            contents.append(c)
            if len(contents) >= 6:
                break
        return "\n".join(f"- {c}" for c in contents) if contents else "No relevant memories."
    except Exception as exc:  # memory is an enhancement, not a hard dependency
        print(f"[recall_memory] warning: memory search failed, degrading gracefully ({exc})")
        return "No relevant memories."


async def recall_memory(query: str) -> str:
    """Recall the traveler's durable preferences relevant to `query`."""
    return await asyncio.to_thread(_recall_sync, query)


async def search_flights(destination: str) -> str:
    """Return mock flight options matching `destination` (or all, if no match)."""
    matches = [t for t in _FLIGHTS if destination.lower() in t["destination"].lower()]
    return json.dumps(matches or _FLIGHTS)


def _str_prop(title: str, description: str) -> Property:
    return Property(title=title, json_schema={"title": title, "type": "string", "description": description})


recall_memory_tool = ServerTool(
    name="recall_memory",
    description="Recall the traveler's durable saved preferences relevant to a query.",
    inputs=[_str_prop("query", "What to recall, e.g. 'dietary needs' or 'seat preference'.")],
    outputs=[_str_prop("memories", "Relevant recalled preferences, newline-separated.")],
)

search_flights_tool = ServerTool(
    name="search_flights",
    description="Search available flight options by destination.",
    inputs=[_str_prop("destination", "Destination city to search for, e.g. 'Amsterdam'.")],
    outputs=[_str_prop("results", "JSON array of matching flight options.")],
)

book_flight_tool = ClientTool(
    name="book_flight",
    description="Book the chosen flight by its id. The traveler confirms in the UI before it is finalized.",
    inputs=[_str_prop("flight_id", "The id of the flight to book, e.g. 'AMS-001'.")],
    outputs=[_str_prop("confirmation", "Human-readable booking confirmation.")],
)

TOOLS = [recall_memory_tool, search_flights_tool, book_flight_tool]
# book_flight is client-executed (ClientTool / HITL) — it must NOT appear here.
TOOL_REGISTRY = {
    "recall_memory": recall_memory,
    "search_flights": search_flights,
}
