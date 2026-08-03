"""
The graph — a deliberately minimal LangGraph agent for probing channels' LEGACY
interrupt-based HITL path.

WHY THIS EXISTS: `route-b.ts` needs a real agent that actually suspends. The
umbrella's other HITL model (`thread.awaitChoice`) blocks inside a channel-side
tool handler and never involves the agent's own control flow. This one is the
opposite: `create_thing` calls LangGraph's `interrupt()`, the graph SUSPENDS in
its checkpointer, and `ag_ui_langgraph` emits an AG-UI custom event named
`on_interrupt` (see `LangGraphEventTypes.OnInterrupt`). That event name is
exactly what the Slack adapter watches for by default, so the channel's
`onInterrupt("on_interrupt", ...)` handler fires and the run loop ends.

The graph then sits in the checkpointer — across restarts, since resumption is
keyed only by `thread_id` — until a resume arrives as
`forwardedProps.command.resume`, which `ag_ui_langgraph` turns back into a
LangGraph `Command(resume=...)`.

`create_thing` writes NOTHING. It exists purely so the interrupt fires
deterministically with no Linear/Notion/MCP credentials in play.
"""

import os
import re

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt

load_dotenv()


@tool
def create_thing(name: str, detail: str = "") -> str:
    """Create a thing. This performs a WRITE and requires human approval first.

    Call this whenever the user asks to create, make, add, or file a "thing".
    Do not ask for confirmation in chat yourself — just call this tool; it
    raises the approval prompt on its own and returns the user's decision.
    """
    # NOTE: this line prints TWICE per approval — once when the graph suspends and
    # again when it resumes — because `interrupt()` re-invokes the tool from the
    # top rather than continuing where it left off. That is exactly why real side
    # effects must live BELOW the interrupt, and seeing it doubled in the log is
    # the cheapest proof of the re-execution semantic.
    print(f"[create_thing] called name={name!r} detail={detail!r}", flush=True)

    # This SUSPENDS the graph. Execution stops mid-tool: everything above this
    # line has already run, nothing below it has. On resume, `interrupt()` returns
    # the resume value instead of suspending again.
    decision = interrupt(
        {
            # `kind` is ours, not LangGraph's — the channel handler switches on
            # it so one `on_interrupt` event name can serve several pickers.
            "kind": "confirm_create_thing",
            "action": f"Create thing: {name}",
            "detail": detail or None,
        }
    )

    # `decision` is whatever `thread.resume(value)` sent. Be defensive: it is
    # user-shaped data that crossed two process boundaries, and a resume with an
    # unexpected shape must read as "not approved" rather than as approval.
    approved = isinstance(decision, dict) and decision.get("approved") is True

    # Everything past the interrupt runs ONLY on resume, so this is the one place
    # that can report how the user actually answered. Log the raw value alongside
    # the verdict: a resume whose shape is wrong (anything but `{"approved": true}`)
    # reads as a decline, and without the raw value that is indistinguishable from
    # someone genuinely clicking Cancel.
    print(
        f"[create_thing] RESUMED name={name!r} raw={decision!r} → "
        f"{'APPROVED' if approved else 'DECLINED'}",
        flush=True,
    )

    if not approved:
        return f"The user DECLINED — '{name}' was not created. Acknowledge and stop."
    # Deliberately a no-op: this probe asserts the interrupt/resume round trip,
    # not persistence. A real tool would do its write here.
    return (
        f"Created '{name}'. (No-op probe — nothing was actually persisted.) "
        "Confirm to the user in one short sentence."
    )


# AGENT_MODEL is SHARED with runtime.ts, whose `.env.example` documents the
# "openai/<id>" form — so strip that prefix here too, exactly as runtime.ts does.
# Without this, the one env file serving both agents would need two different
# spellings of the same model, and `openai/gpt-5.5` would reach ChatOpenAI as a
# bogus model id.
model = ChatOpenAI(
    model=re.sub(r"^openai/", "", os.environ.get("AGENT_MODEL") or "gpt-5.5")
)

# MemorySaver keeps the suspended graph in THIS process's memory, so a restart
# loses anything mid-interrupt. That's the right default for a probe (zero
# setup) but it is also the thing to swap for a real checkpointer the moment you
# want to test approving after a redeploy.
graph = create_agent(
    model=model,
    tools=[create_thing],
    checkpointer=MemorySaver(),
    system_prompt=(
        "You are a terse test agent for probing a chat-channel integration. "
        "Keep every reply to one or two short sentences.\n\n"
        "When the user asks you to create/make/add/file a 'thing', call the "
        "create_thing tool immediately. The tool handles approval itself — "
        "never ask the user to confirm in chat, and never claim you created "
        "anything until the tool has returned."
    ),
)
