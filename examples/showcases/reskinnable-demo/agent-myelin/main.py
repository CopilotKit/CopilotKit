"""Myelin's journey-builder admin agent: Google ADK, served over AG-UI.

The reskinnable demo's Next app registers this endpoint as a plain AG-UI
`HttpAgent` (like banking's agent on :8124), so everything this service emits
(text, server tool calls, and calls to the BROWSER's frontend tools) rides one
AG-UI stream.

Three things cross the wire here:

* SERVER TOOLS (below) call the app's REST API at `MYELIN_API_BASE`. They are the
  same routes the pages use, so the admin watches the agent's writes land live.
  A refusal is RETURNED, not raised, so the model reads the refusal text.
* `AGUIToolset()` stands in for everything the browser registers: the frontend
  tools (openJourney, showJourney, reviewPublish, showLearners, teach mode) and
  the CopilotKit Intelligence memory tools (recall_memory, save_memory,
  forget_memory). ag_ui_adk swaps it for the run's forwarded client tools.
* The browser's readables arrive as AG-UI `context`. ag_ui_adk stores them in
  session state under `_ag_ui_context`, and `instruction()` appends them to the
  system prompt on every model call. That is how the agent sees the screen.

PRIVACY: no tool returns learner names or learner ids. The agent works with
counts; the browser resolves names client-side.
"""

from __future__ import annotations

import json
import os
import pathlib
from typing import Any, Optional

import httpx
from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext

from prompt import MYELIN_PROMPT

# This service's own `.env` first (wins on conflict: python-dotenv never
# overrides an already-set value), then the demo app's `.env`, which already
# holds the OPENAI_API_KEY the rest of the app uses.
_HERE = pathlib.Path(__file__).parent
load_dotenv(_HERE / ".env")
load_dotenv(_HERE.parent / ".env")

API_BASE = os.getenv("MYELIN_API_BASE", "http://localhost:3000/api/myelin/v1").rstrip("/")
MODEL = os.getenv("MYELIN_MODEL", "openai/gpt-5.4")
CONTEXT_STATE_KEY = "_ag_ui_context"

# ── REST plumbing ───────────────────────────────────────────────────────────


async def _call(method: str, path: str, body: Optional[dict] = None) -> dict[str, Any]:
    """Call the Myelin REST API as the agent. Never raises.

    Success returns `{"ok": True, "data": <json>}`. Any non-2xx returns the
    route's own `{error, message, ...}` body with `ok: False`, so the model sees
    the exact refusal a human would.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.request(
                method,
                f"{API_BASE}{path}",
                json=body,
                headers={"x-myelin-actor": "agent"},
            )
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "error": "UNREACHABLE",
            "message": f"The Myelin platform did not respond ({type(exc).__name__}).",
        }
    try:
        payload = res.json()
    except ValueError:
        payload = None
    if res.is_success:
        return {"ok": True, "data": payload}
    if isinstance(payload, dict):
        return {
            "ok": False,
            "error": payload.get("error", f"HTTP_{res.status_code}"),
            "message": payload.get("message", "The request was refused."),
            **{k: v for k, v in payload.items() if k not in ("error", "message")},
        }
    return {"ok": False, "error": f"HTTP_{res.status_code}", "message": "The request was refused."}


def _item(it: dict) -> dict:
    return {
        "id": it.get("id"),
        "title": it.get("title"),
        "kind": it.get("kind"),
        "minutes": it.get("minutes"),
        "dependsOn": it.get("dependsOn", []),
        "delayDays": it.get("delayDays", 0),
        "required": it.get("required", True),
    }


def _journey(j: dict, groups_by_id: Optional[dict[str, dict]] = None) -> dict:
    items = j.get("items", [])
    audience_ids = j.get("audienceGroupIds", [])
    if groups_by_id is not None:
        audience = [
            {"id": gid, "name": groups_by_id.get(gid, {}).get("name", gid)} for gid in audience_ids
        ]
    else:
        audience = audience_ids
    return {
        "id": j.get("id"),
        "name": j.get("name"),
        "status": j.get("status"),
        "description": j.get("description", ""),
        "audienceGroups": audience,
        "audienceRules": len(j.get("audienceRules", [])),
        "enrollmentWindowDays": j.get("enrollmentWindowDays"),
        "items": [_item(it) for it in items],
        "totalMinutes": sum(int(it.get("minutes") or 0) for it in items),
    }


def _fail_or(result: dict, shape) -> dict:
    return shape(result["data"]) if result["ok"] else result


# ── Server tools ────────────────────────────────────────────────────────────


async def get_workspace() -> dict:
    """Read the Myelin workspace: every journey and every learner group.

    Call this before editing whenever you do not already have fresh ids, and use
    it to resolve journeys and groups by name.

    Returns:
        journeys: id, name, status (draft/published), description, audience
            groups (id + name), number of audience rules applied, enrollment
            window, items (id, title, kind, minutes, dependsOn, delayDays,
            required) and total minutes.
        groups: id, name, department, store, learnerCount.
        Learner counts only; no individual learners.
    """
    res = await _call("GET", "/ledger")
    if not res["ok"]:
        return res
    data = res["data"] or {}
    groups = [
        {
            "id": g.get("id"),
            "name": g.get("name"),
            "department": g.get("department"),
            "store": g.get("store"),
            "learnerCount": g.get("learnerCount"),
        }
        for g in data.get("groups", [])
    ]
    by_id = {g["id"]: g for g in groups}
    return {
        "ok": True,
        "journeys": [_journey(j, by_id) for j in data.get("journeys", [])],
        "groups": groups,
    }


async def create_journey(
    name: str, description: str, audience_group_ids: Optional[list[str]] = None
) -> dict:
    """Create a new DRAFT learning journey.

    Args:
        name: The journey's name, e.g. "Deli Onboarding".
        description: One sentence on who it is for and what it covers.
        audience_group_ids: Group ids (from get_workspace) to assign as the
            audience. Omit or pass [] for none yet.

    Returns:
        The created journey, including its new `id`. Open it with openJourney
        straight away, then add items with add_item.
    """
    body = {"name": name, "description": description, "audienceGroupIds": audience_group_ids or []}
    return _fail_or(await _call("POST", "/journeys", body), lambda d: {"ok": True, "journey": _journey(d)})


async def add_item(
    journey_id: str,
    title: str,
    kind: str,
    minutes: int,
    depends_on: Optional[list[str]] = None,
    delay_days: int = 0,
    required: bool = True,
) -> dict:
    """Add one item (a step) to a draft journey.

    Args:
        journey_id: The journey's id.
        title: Short, specific title, e.g. "Slicer safety".
        kind: One of "microlesson", "video", "quiz", "checklist",
            "observation", "certification".
        minutes: Seat time in minutes (microlessons ~3-6, quizzes ~3-5,
            observations ~15-30).
        depends_on: Ids of items already in this journey that must be completed
            first. Use the ids returned by earlier add_item calls.
        delay_days: Days to wait after the prerequisites complete before this
            item unlocks (a practice gap). 0 unlocks at once.
        required: Whether the item is required to complete the journey.

    Returns:
        The created item including its `id`, so later items can depend on it.
    """
    body = {
        "title": title,
        "kind": kind,
        "minutes": minutes,
        "dependsOn": depends_on or [],
        "delayDays": delay_days,
        "required": required,
    }
    return _fail_or(
        await _call("POST", f"/journeys/{journey_id}/items", body),
        lambda d: {"ok": True, "item": _item(d)},
    )


async def update_item(
    journey_id: str,
    item_id: str,
    title: Optional[str] = None,
    kind: Optional[str] = None,
    minutes: Optional[int] = None,
    depends_on: Optional[list[str]] = None,
    delay_days: Optional[int] = None,
    required: Optional[bool] = None,
) -> dict:
    """Edit an existing item in a draft journey. Only the fields you pass change.

    Use this for prerequisites (depends_on replaces the whole list), practice
    gaps (delay_days), retitling, re-timing or changing kind.

    Args:
        journey_id: The journey's id.
        item_id: The item's id.
        title: New title.
        kind: One of "microlesson", "video", "quiz", "checklist",
            "observation", "certification".
        minutes: New seat time in minutes.
        depends_on: The COMPLETE new list of prerequisite item ids ([] clears).
        delay_days: New days to wait after prerequisites complete.
        required: Whether the item is required.

    Returns:
        The updated item, or a refusal (e.g. DEPENDENCY_CYCLE).
    """
    fields = {
        "title": title,
        "kind": kind,
        "minutes": minutes,
        "dependsOn": depends_on,
        "delayDays": delay_days,
        "required": required,
    }
    body = {k: v for k, v in fields.items() if v is not None}
    return _fail_or(
        await _call("PATCH", f"/journeys/{journey_id}/items/{item_id}", body),
        lambda d: {"ok": True, "item": _item(d)},
    )


async def remove_item(journey_id: str, item_id: str) -> dict:
    """Remove an item from a draft journey.

    Items that depended on it are re-wired onto its own prerequisites, so the
    sequence stays intact.

    Args:
        journey_id: The journey's id.
        item_id: The item's id.
    """
    return _fail_or(
        await _call("DELETE", f"/journeys/{journey_id}/items/{item_id}"),
        lambda d: {"ok": True, "removed": item_id},
    )


async def set_audience(journey_id: str, group_ids: list[str]) -> dict:
    """Set a draft journey's audience: the COMPLETE list of assigned group ids.

    Args:
        journey_id: The journey's id.
        group_ids: Every group id that should be assigned (replaces the list).
    """
    return _fail_or(
        await _call("PATCH", f"/journeys/{journey_id}", {"audienceGroupIds": group_ids}),
        lambda d: {"ok": True, "journey": _journey(d)},
    )


async def check_audience(journey_id: str) -> dict:
    """Run the pre-publish audience check on a journey.

    Returns:
        audienceSize: learners the journey would reach.
        totalMinutes: the journey's total seat time.
        unresolved: how many conflicts would still block publishing.
        conflicts: per other active journey: otherJourneyName,
            overlappingLearners (a count), groupIds, weeklyMinutesIfConcurrent
            and policy (the rule an overlap breaks).
    """
    res = await _call("GET", f"/journeys/{journey_id}/audience-check")
    if not res["ok"]:
        return res
    d = res["data"] or {}
    return {
        "ok": True,
        "journeyId": d.get("journeyId", journey_id),
        "audienceSize": d.get("audienceSize"),
        "totalMinutes": d.get("totalMinutes"),
        "unresolved": d.get("unresolved"),
        "rulesApplied": d.get("rulesApplied"),
        # learnerIds are stripped here on purpose: counts only.
        "conflicts": [
            {
                "otherJourneyName": c.get("otherJourneyName"),
                "overlappingLearners": len(c.get("learnerIds", [])),
                "groupIds": c.get("groupIds", []),
                "weeklyMinutesIfConcurrent": c.get("weeklyMinutesIfConcurrent"),
                "policy": c.get("policy"),
            }
            for c in d.get("conflicts", [])
        ],
    }


async def apply_audience_rule(journey_id: str, rule: str) -> dict:
    """Apply an audience rule by its name. Only use a rule name you have been explicitly taught or that a saved procedure names.

    Args:
        journey_id: The journey's id.
        rule: The rule name.
    """
    return _fail_or(
        await _call("POST", f"/journeys/{journey_id}/rules", {"rule": rule}),
        lambda d: {"ok": True, "journey": _journey(d)},
    )


async def publish_journey(journey_id: str) -> dict:
    """Publish a draft journey to its audience.

    Only call this after reviewPublish has come back APPROVED for this journey.
    A refusal is returned (never raised) with its reason and, for an audience
    overlap, the conflicts as counts.

    Args:
        journey_id: The journey's id.
    """
    return _fail_or(
        await _call("POST", f"/journeys/{journey_id}/publish"),
        lambda d: {"ok": True, "journey": _journey(d)},
    )


async def set_enrollment_window(journey_id: str, days: int) -> dict:
    """Set how many days learners have to enrol in a journey (1-90).

    Args:
        journey_id: The journey's id.
        days: Enrollment window in days.
    """
    return _fail_or(
        await _call("POST", f"/journeys/{journey_id}/enrollment", {"days": days}),
        lambda d: {"ok": True, "enrollmentWindowDays": d.get("enrollmentWindowDays")},
    )


async def notify_store_managers(journey_id: str, message: str) -> dict:
    """Notify the store managers of every store in a journey's audience.

    Args:
        journey_id: The journey's id.
        message: The note to send, written for a store manager.
    """
    return _fail_or(
        await _call("POST", f"/journeys/{journey_id}/notify", {"message": message}),
        lambda d: {"ok": True, "sentTo": d.get("audience"), "message": d.get("message")},
    )


async def schedule_reminder(journey_id: str, after_days: int, message: str) -> dict:
    """Schedule a reminder nudge for learners who have not started a journey.

    Args:
        journey_id: The journey's id.
        after_days: Days after launch to send it (1-60).
        message: The nudge text learners receive.
    """
    return _fail_or(
        await _call(
            "POST",
            f"/journeys/{journey_id}/reminders",
            {"afterDays": after_days, "message": message},
        ),
        lambda d: {"ok": True, "afterDays": d.get("afterDays"), "message": d.get("message")},
    )


SERVER_TOOLS = [
    get_workspace,
    create_journey,
    add_item,
    update_item,
    remove_item,
    set_audience,
    check_audience,
    apply_audience_rule,
    publish_journey,
    set_enrollment_window,
    notify_store_managers,
    schedule_reminder,
]

# ── Instruction provider: prompt + the admin's screen ───────────────────────


def _render_context(entries: Any) -> str:
    if not entries:
        return ""
    lines = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        value = entry.get("value")
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False)
        lines.append(f"### {entry.get('description') or 'Context'}\n{value}")
    return "\n\n".join(lines)


def instruction(ctx: ReadonlyContext) -> str:
    """The system prompt, with the browser's readables (the screen) appended.

    A callable instruction also means ADK does NOT run `{placeholder}`
    templating over the prompt, so braces in the screen JSON are safe.
    """
    screen = _render_context(ctx.state.get(CONTEXT_STATE_KEY))
    if not screen:
        return MYELIN_PROMPT
    return (
        f"{MYELIN_PROMPT}\n\n"
        "THE ADMIN'S SCREEN RIGHT NOW (these context entries are what they see):\n\n"
        f"{screen}"
    )


# ── Model ───────────────────────────────────────────────────────────────────


def build_model():
    """`MYELIN_MODEL` picks the model. A `gemini*` name runs natively on Gemini
    (needs GOOGLE_API_KEY); anything else goes through ADK's LiteLLM wrapper."""
    if MODEL.startswith("gemini"):
        return MODEL
    from google.adk.models.lite_llm import LiteLlm

    # Sequential tool calls: the journey build adds items ONE AT A TIME and each
    # add_item needs the ids returned by the previous ones for depends_on.
    return LiteLlm(model=MODEL, parallel_tool_calls=False)


def _log_tool_call(tool, args, tool_context):
    """One line per tool call in the agent log, so a presenter (or a debugger)
    can see what the model actually did — server tools, browser tools and the
    Intelligence memory tools alike."""
    print(f"[myelin-agent] tool {tool.name} {json.dumps(args, default=str)[:400]}", flush=True)
    return None


def _log_model_reply(llm_response):
    parts = (llm_response.content.parts if llm_response.content else None) or []
    calls = [p.function_call.name for p in parts if getattr(p, "function_call", None)]
    text = " ".join((p.text or "") for p in parts if getattr(p, "text", None))[:160]
    print(f"[myelin-agent] model reply calls={calls} text={text!r}", flush=True)
    return None


def _log_model_tools(callback_context, llm_request):
    names = sorted(getattr(llm_request, "tools_dict", {}) or {})
    print(f"[myelin-agent] model sees {len(names)} tools: {', '.join(names)}", flush=True)
    return None


myelin_agent = LlmAgent(
    name="MyelinJourneyAgent",
    model=build_model(),
    instruction=instruction,
    tools=[*SERVER_TOOLS, AGUIToolset()],
    before_tool_callback=_log_tool_call,
    before_model_callback=_log_model_tools,
    after_model_callback=lambda callback_context, llm_response: _log_model_reply(llm_response),
)

class MyelinADKAgent(ADKAgent):
    """ADKAgent that tolerates non-object tool results from the browser.

    ag-ui-adk 0.7.0 json-decodes a client tool's result and hands it straight to
    `types.FunctionResponse(response=...)`, which only accepts a dict. The
    Intelligence memory tools legitimately return JSON ARRAYS (`recall_memory`
    with nothing saved is `[]`), and a frontend tool may return a bare JSON
    string or number — each of those crashed the run with a pydantic
    `dict_type` error. Wrap anything that is valid JSON but not an object as
    `{"result": value}` before the base class builds the response parts.
    """

    def _build_function_response_parts(self, tool_results, lro_id_remap):
        for tool_result in tool_results:
            message = tool_result["message"]
            content = message.content
            print(
                f"[myelin-agent] client result {tool_result.get('tool_name')} {str(content)[:300]}",
                flush=True,
            )
            if not content or not content.strip():
                continue
            try:
                value = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                continue  # plain text: the base class already wraps it
            if not isinstance(value, dict):
                message.content = json.dumps({"result": value})
        return super()._build_function_response_parts(tool_results, lro_id_remap)


adk_myelin_agent = MyelinADKAgent(
    adk_agent=myelin_agent,
    app_name="myelin",
    user_id="myelin-admin",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(
    title="Myelin journey-builder agent",
    description="Google ADK agent behind the reskinnable demo's myelin skin",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Health check: `run-demo.sh` waits on this."""
    return {"status": "ok", "service": "myelin-agent", "model": MODEL}


add_adk_fastapi_endpoint(app, adk_myelin_agent, path="/")


def main():
    import uvicorn

    host = os.getenv("MYELIN_AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("MYELIN_AGENT_PORT", "8125"))
    if MODEL.startswith("gemini") and not os.getenv("GOOGLE_API_KEY"):
        print("[myelin-agent] WARNING: MYELIN_MODEL is Gemini but GOOGLE_API_KEY is not set")
    elif not MODEL.startswith("gemini") and MODEL.startswith("openai/") and not os.getenv("OPENAI_API_KEY"):
        print("[myelin-agent] WARNING: OPENAI_API_KEY is not set")
    print(f"[myelin-agent] model={MODEL} api={API_BASE} listening on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
