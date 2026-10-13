"""Call every server tool directly against MYELIN_API_BASE (no model involved).

Needs the Next dev server running with the myelin skin (default
http://localhost:3000/api/myelin/v1). It writes to the in-memory store: it
creates one scratch journey ("Smoke test journey"); restart the dev server for
a clean seed afterwards.

It deliberately never applies the real audience rule, so running it does not
leak the teach-a-skill answer into anything.

    .venv/bin/python smoke_tools.py
"""

import asyncio
import json
import sys

import httpx

import main as m


def show(label: str, value) -> None:
    print(f"--- {label}\n{json.dumps(value, indent=2)[:1200]}\n")


def expect(cond: bool, what: str) -> None:
    if not cond:
        print(f"FAIL: {what}")
        sys.exit(1)
    print(f"ok: {what}")


async def run() -> None:
    try:
        httpx.get(f"{m.API_BASE}/ledger", timeout=5).raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"SKIP: {m.API_BASE}/ledger is not reachable ({exc}). Start the Next dev server first.")
        return

    ws = await m.get_workspace()
    show("get_workspace", ws)
    expect(ws["ok"] and ws["journeys"] and ws["groups"], "workspace has journeys and groups")
    blob = json.dumps(ws)
    expect("learners" not in blob and "learnerIds" not in blob, "workspace carries no learner rows")

    created = await m.create_journey("Smoke test journey", "Scratch journey from smoke_tools.py", ["g-deli-north"])
    show("create_journey", created)
    jid = created["journey"]["id"]

    a = await m.add_item(jid, "Welcome", "video", 3)
    b = await m.add_item(jid, "Slicer safety", "microlesson", 5, depends_on=[a["item"]["id"]])
    c = await m.add_item(jid, "Slicer walkthrough", "observation", 20, depends_on=[b["item"]["id"]], delay_days=2)
    show("add_item x3", [a, b, c])
    expect(c["item"]["dependsOn"] == [b["item"]["id"]], "add_item returns ids usable in depends_on")

    bad = await m.add_item(jid, "Bad kind", "podcast", 5)
    show("add_item (bad kind)", bad)
    expect(bad["ok"] is False and bad["error"] == "INVALID_KIND", "refusal is returned, not raised")

    upd = await m.update_item(jid, c["item"]["id"], delay_days=3)
    show("update_item", upd)
    expect(upd["item"]["delayDays"] == 3 and upd["item"]["dependsOn"] == [b["item"]["id"]], "update_item sends only given fields")

    cyc = await m.update_item(jid, a["item"]["id"], depends_on=[c["item"]["id"]])
    expect(cyc["ok"] is False and cyc["error"] == "DEPENDENCY_CYCLE", "cycle refused")

    rm = await m.remove_item(jid, b["item"]["id"])
    show("remove_item", rm)
    expect(rm["ok"], "remove_item")

    aud = await m.set_audience(jid, ["g-deli-north", "g-deli-river", "g-deli-east"])
    show("set_audience", aud)
    expect(aud["ok"] and len(aud["journey"]["audienceGroups"]) == 3, "set_audience")

    chk = await m.check_audience(jid)
    show("check_audience", chk)
    expect(chk["ok"] and "learnerIds" not in json.dumps(chk), "check_audience strips learnerIds")
    expect(any(x["overlappingLearners"] == 38 for x in chk["conflicts"]), "38-learner Bakery overlap reported as a count")

    rule = await m.apply_audience_rule(jid, "not-a-real-rule")
    show("apply_audience_rule (unknown)", rule)
    expect(rule["ok"] is False and rule["error"] == "UNKNOWN_RULE", "unknown rule refused")

    pub = await m.publish_journey(jid)
    show("publish_journey (blocked)", pub)
    expect(pub["ok"] is False and pub["error"] == "AUDIENCE_OVERLAP" and pub.get("conflicts"), "publish refusal carries message + conflicts")

    win = await m.set_enrollment_window(jid, 21)
    ntf = await m.notify_store_managers(jid, "Smoke test: please ignore.")
    rem = await m.schedule_reminder(jid, 3, "Smoke test nudge.")
    show("launch steps", [win, ntf, rem])
    expect(win["ok"] and ntf["ok"] and rem["ok"], "enrollment / notify / reminder")

    missing = await m.check_audience("j-does-not-exist")
    expect(missing["ok"] is False and missing["error"] == "NOT_FOUND", "unknown journey refused")

    print("\nALL TOOLS OK")


if __name__ == "__main__":
    asyncio.run(run())
