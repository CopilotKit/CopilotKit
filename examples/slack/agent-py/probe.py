"""
Drives the AG-UI endpoint directly — NO Slack, NO channel, NO tokens beyond
OPENAI_API_KEY. This is the fast loop: it asserts the exact contract
`route-b.ts` depends on, so when Slack misbehaves you already know whether the
agent side is at fault.

It runs the full legacy HITL round trip against a live `serve.py`:

  1. turn 1 — ask the agent to create a thing; expect the stream to carry a
     CUSTOM event named `on_interrupt` (the graph is now suspended)
  2. turn 2 — replay the same thread_id with
     `forwardedProps.command.resume = {"approved": true}`; expect NO second
     interrupt and a final assistant reply

Run:  uv run serve.py          # in one terminal
      uv run probe.py          # in another
      uv run probe.py --decline
"""

import json
import sys
import uuid

import httpx

AGENT_URL = "http://127.0.0.1:8210/agent/thing/run"


def payload(thread_id: str, text: str, resume: object | None = None) -> dict:
    """A minimal RunAgentInput. `forwardedProps.command.resume` is the legacy
    LangGraph resume channel — the same field `thread.resume()` populates."""
    return {
        "threadId": thread_id,
        "runId": str(uuid.uuid4()),
        "state": {},
        # On resume the graph reads its messages from the checkpoint, so the
        # user turn only needs to be sent once (turn 1).
        "messages": (
            [{"id": str(uuid.uuid4()), "role": "user", "content": text}]
            if text
            else []
        ),
        "tools": [],
        "context": [],
        "forwardedProps": {"command": {"resume": resume}} if resume is not None else {},
    }


def run(thread_id: str, text: str, resume: object | None = None) -> list[dict]:
    """POST one turn and return the decoded SSE events."""
    events: list[dict] = []
    with httpx.Client(timeout=120) as client:
        with client.stream("POST", AGENT_URL, json=payload(thread_id, text, resume)) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    events.append(json.loads(line[5:].strip()))
                except json.JSONDecodeError:
                    pass
    return events


def interrupts(events: list[dict]) -> list[dict]:
    return [e for e in events if e.get("type") == "CUSTOM" and e.get("name") == "on_interrupt"]


def assistant_text(events: list[dict]) -> str:
    return "".join(
        e.get("delta", "") for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT"
    ).strip()


def main() -> int:
    approved = "--decline" not in sys.argv
    thread_id = str(uuid.uuid4())
    print(f"thread_id={thread_id}  decision={'approve' if approved else 'decline'}\n")

    # ── turn 1: expect a suspend ──────────────────────────────────────────
    print("── turn 1: 'create a thing called widget' ─────────────────────")
    first = run(thread_id, "create a thing called widget, detail: for testing")
    found = interrupts(first)
    if not found:
        types = sorted({e.get("type", "?") for e in first})
        print(f"FAIL: no on_interrupt event. Event types seen: {types}")
        if text := assistant_text(first):
            print(f"       assistant said: {text!r}")
        return 1

    value = found[0].get("value")
    # The Slack renderer JSON.parses a string value before handing it to the
    # handler; mirror that here so the printed payload matches what the channel
    # actually sees.
    if isinstance(value, str):
        value = json.loads(value)
    print(f"PASS: on_interrupt fired, payload = {json.dumps(value)}")
    if value.get("kind") != "confirm_create_thing":
        print(f"WARN: unexpected kind {value.get('kind')!r}")

    # ── turn 2: resume ────────────────────────────────────────────────────
    print(f"\n── turn 2: resume with approved={approved} ────────────────────")
    second = run(thread_id, "", resume={"approved": approved})
    if again := interrupts(second):
        print(f"FAIL: interrupted AGAIN after resume: {again[0].get('value')}")
        return 1

    reply = assistant_text(second)
    if not reply:
        types = sorted({e.get("type", "?") for e in second})
        print(f"FAIL: resumed but produced no assistant text. Types: {types}")
        return 1

    print(f"PASS: graph resumed and finished.\n      assistant: {reply}")
    print("\nRound trip OK — interrupt → resume → completion.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
