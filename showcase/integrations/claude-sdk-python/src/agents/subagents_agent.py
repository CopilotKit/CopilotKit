"""Claude Agent SDK backing the Sub-Agents demo.

A supervisor Claude call orchestrates three specialised sub-agents
exposed as tools:

  - ``research_agent``  — gathers facts on a topic
  - ``writing_agent``   — drafts polished prose from a brief + facts
  - ``critique_agent``  — reviews a draft and suggests improvements

Each delegation issues its own single-shot Anthropic SDK call with a
sub-agent-specific system prompt. This mirrors the ``google-adk`` pattern
in ``subagents_agent.py`` (which uses ``client.models.generate_content``
under the hood) — a much lighter approach than spinning up a full second
agent loop, but conceptually identical.

Every delegation appends an entry to ``state["delegations"]`` with shape
``{id, sub_agent, task, status, result}``. Entries are emitted as
``running`` first and flipped to ``completed`` / ``failed`` once the
sub-agent returns, so the UI's delegation log animates in real time.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import anthropic
from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

logger = logging.getLogger(__name__)

# Default Anthropic model. Pinned to a dated identifier rather than an alias
# so the demo doesn't break when Anthropic rotates aliases. Override with the
# ANTHROPIC_MODEL or ANTHROPIC_SUBAGENT_MODEL env vars.
DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"


# @region[subagent-setup]
# Each sub-agent is defined by its own system prompt; `_invoke_sub_agent`
# (below) issues a single-shot Anthropic call as that sub-agent. They
# don't share memory or tools with the supervisor — the supervisor only
# ever sees what the sub-agent returns as a tool result.
# @region[subagents-system-prompts]
SUB_AGENT_PROMPTS: dict[str, str] = {
    "research_agent": (
        "You are a research sub-agent. Given a topic, produce a concise "
        "bulleted list of 3-5 key facts. No preamble, no closing."
    ),
    "writing_agent": (
        "You are a writing sub-agent. Given a brief and optional source "
        "facts, produce a polished 1-paragraph draft. Be clear and "
        "concrete. No preamble."
    ),
    "critique_agent": (
        "You are an editorial critique sub-agent. Given a draft, give "
        "2-3 crisp, actionable critiques. No preamble."
    ),
}
# @endregion[subagents-system-prompts]


SUPERVISOR_SYSTEM_PROMPT = (
    "You are a supervisor agent that coordinates three specialized "
    "sub-agents to produce high-quality deliverables.\n\n"
    "Available sub-agents (call them as tools):\n"
    "  - research_agent: gathers facts on a topic.\n"
    "  - writing_agent: turns facts + a brief into a polished draft.\n"
    "  - critique_agent: reviews a draft and suggests improvements.\n\n"
    "For most non-trivial user requests, delegate in sequence: "
    "research -> write -> critique. Pass the relevant facts/draft "
    "through the `task` argument of each tool. Keep your own messages "
    "short — explain the plan once, delegate, then return a concise "
    "summary once done. The UI shows the user a live log of every "
    "sub-agent delegation, including the in-flight 'running' state."
)


# @region[supervisor-delegation-tools]
# The supervisor delegates by calling tools. Each entry in
# `SUPERVISOR_TOOLS` is an Anthropic tool schema that the supervisor LLM
# "calls" to delegate work; the run loop in `run_subagents_agent` (see
# the subagents-delegation-flow region) runs the matching sub-agent
# synchronously, records the delegation into shared agent state, and
# returns the sub-agent's output as a tool_result the supervisor can
# read on its next step.
def _delegation_tool_schema(name: str, description: str) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": (
                        "The full task description to hand to the "
                        "sub-agent. Pass relevant prior facts/drafts "
                        "verbatim — the sub-agent has no shared memory "
                        "with the supervisor."
                    ),
                }
            },
            "required": ["task"],
        },
    }


SUPERVISOR_TOOLS: list[dict[str, Any]] = [
    _delegation_tool_schema(
        "research_agent",
        "Delegate a research task. Returns a bulleted list of key facts.",
    ),
    _delegation_tool_schema(
        "writing_agent",
        (
            "Delegate a drafting task. Pass relevant facts in `task`. "
            "Returns a polished paragraph."
        ),
    ),
    _delegation_tool_schema(
        "critique_agent",
        "Delegate a critique task. Returns 2-3 actionable critiques.",
    ),
]
# @endregion[supervisor-delegation-tools]


# @region[subagents-invocation]
async def _invoke_sub_agent(
    client: anthropic.AsyncAnthropic,
    sub_agent: str,
    task: str,
) -> str:
    """Issue a single-shot Anthropic call as the named sub-agent.

    Returns the concatenated text content of the response. Raises any
    SDK exception so the caller can mark the delegation as ``failed``.
    """
    response = await client.messages.create(
        model=os.getenv("ANTHROPIC_SUBAGENT_MODEL", DEFAULT_ANTHROPIC_MODEL),
        max_tokens=1024,
        system=SUB_AGENT_PROMPTS[sub_agent],
        messages=[{"role": "user", "content": task}],
    )
    parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", ""))
    text = "".join(parts).strip()
    if not text:
        raise RuntimeError("sub-agent returned empty response")
    return text
# @endregion[subagents-invocation]
# @endregion[subagent-setup]


def _convert_messages(input_data: RunAgentInput) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for msg in (input_data.messages or []):
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role not in ("user", "assistant"):
            continue
        raw_content = getattr(msg, "content", None)
        content = ""
        if isinstance(raw_content, str):
            content = raw_content
        elif isinstance(raw_content, list):
            parts = []
            for part in raw_content:
                if hasattr(part, "text"):
                    parts.append(part.text)
                elif isinstance(part, dict) and "text" in part:
                    parts.append(part["text"])
            content = "".join(parts)
        if content:
            messages.append({"role": role, "content": content})
    return messages


async def run_subagents_agent(
    input_data: RunAgentInput,
) -> AsyncIterator[str]:
    """Run the supervisor and yield AG-UI events.

    Each delegation:
      1. Appends a ``running`` entry to ``state['delegations']`` and
         emits a StateSnapshotEvent.
      2. Issues the sub-agent's Anthropic call.
      3. Mutates the entry in place to ``completed`` / ``failed`` and
         emits another StateSnapshotEvent.
      4. Returns the sub-agent's text as a ToolCallResult so the
         supervisor can use it on its next step.
    """
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    state: dict[str, Any] = {
        "delegations": list(
            (input_data.state or {}).get("delegations") or []
        )
        if isinstance(input_data.state, dict)
        else []
    }

    messages = _convert_messages(input_data)
    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(
        RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )
    )
    yield encoder.encode(
        StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state)
    )

    while True:
        response_text = ""
        tool_calls: list[dict[str, Any]] = []
        msg_id = f"msg-{run_id}-{len(messages)}"

        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=msg_id,
                role="assistant",
            )
        )

        async with client.messages.stream(
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
            max_tokens=2048,
            system=SUPERVISOR_SYSTEM_PROMPT,
            messages=messages,
            tools=SUPERVISOR_TOOLS,
        ) as stream:
            current_tool_id: str | None = None
            current_tool_name: str | None = None
            current_tool_args = ""

            async for event in stream:
                etype = type(event).__name__

                if etype == "RawContentBlockStartEvent":
                    block = event.content_block  # type: ignore[attr-defined]
                    if block.type == "tool_use":
                        current_tool_id = block.id
                        current_tool_name = block.name
                        current_tool_args = ""
                        yield encoder.encode(
                            ToolCallStartEvent(
                                type=EventType.TOOL_CALL_START,
                                tool_call_id=current_tool_id,
                                tool_call_name=current_tool_name,
                                parent_message_id=msg_id,
                            )
                        )

                elif etype == "RawContentBlockDeltaEvent":
                    delta = event.delta  # type: ignore[attr-defined]
                    if delta.type == "text_delta":
                        response_text += delta.text
                        yield encoder.encode(
                            TextMessageContentEvent(
                                type=EventType.TEXT_MESSAGE_CONTENT,
                                message_id=msg_id,
                                delta=delta.text,
                            )
                        )
                    elif delta.type == "input_json_delta":
                        current_tool_args += delta.partial_json
                        yield encoder.encode(
                            ToolCallArgsEvent(
                                type=EventType.TOOL_CALL_ARGS,
                                tool_call_id=current_tool_id or "",
                                delta=delta.partial_json,
                            )
                        )

                elif etype == "RawContentBlockStopEvent":
                    if current_tool_id and current_tool_name:
                        yield encoder.encode(
                            ToolCallEndEvent(
                                type=EventType.TOOL_CALL_END,
                                tool_call_id=current_tool_id,
                            )
                        )
                        parsed_args: dict[str, Any] | None
                        try:
                            parsed_args = (
                                json.loads(current_tool_args)
                                if current_tool_args
                                else {}
                            )
                        except json.JSONDecodeError as exc:
                            # Surface malformed tool args loudly instead of
                            # silently substituting an empty dict — calling
                            # a sub-agent with empty arguments is worse than
                            # skipping the delegation outright.
                            logger.warning(
                                "subagents: failed to parse tool args for "
                                "%s (id=%s): %s; raw=%r",
                                current_tool_name,
                                current_tool_id,
                                exc,
                                current_tool_args,
                            )
                            yield encoder.encode(
                                RunErrorEvent(
                                    type=EventType.RUN_ERROR,
                                    message=(
                                        f"Failed to parse arguments for tool "
                                        f"'{current_tool_name}': {exc}"
                                    ),
                                    code="TOOL_ARGS_PARSE_ERROR",
                                )
                            )
                            parsed_args = None

                        if parsed_args is not None:
                            tool_calls.append(
                                {
                                    "id": current_tool_id,
                                    "name": current_tool_name,
                                    "input": parsed_args,
                                }
                            )
                        # else: skip this delegation entirely rather than
                        # invoking the sub-agent with an empty task.
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_args = ""

        yield encoder.encode(
            TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id)
        )

        if not tool_calls:
            break

        # Persist supervisor turn into the message history.
        assistant_content: list[dict[str, Any]] = []
        if response_text:
            assistant_content.append({"type": "text", "text": response_text})
        for tc in tool_calls:
            assistant_content.append(
                {
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["name"],
                    "input": tc["input"],
                }
            )
        messages.append({"role": "assistant", "content": assistant_content})

        # @region[subagents-delegation-flow]
        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            sub_agent = tc["name"]
            task = (tc["input"] or {}).get("task", "")

            if sub_agent not in SUB_AGENT_PROMPTS:
                err = f"unknown sub-agent: {sub_agent}"
                yield encoder.encode(
                    ToolCallResultEvent(
                        type=EventType.TOOL_CALL_RESULT,
                        tool_call_id=tc["id"],
                        content=err,
                    )
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tc["id"],
                        "content": err,
                    }
                )
                continue

            entry_id = str(uuid.uuid4())
            entry: dict[str, Any] = {
                "id": entry_id,
                "sub_agent": sub_agent,
                "task": task,
                "status": "running",
                "result": "",
            }
            state["delegations"] = [*state["delegations"], entry]
            yield encoder.encode(
                StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state)
            )

            try:
                result_text = await _invoke_sub_agent(client, sub_agent, task)
                final_status = "completed"
            except Exception as exc:  # noqa: BLE001 — surface any failure to UI
                logger.exception("subagent: %s failed", sub_agent)
                result_text = (
                    f"sub-agent call failed: {exc.__class__.__name__} "
                    "(see server logs for details)"
                )
                final_status = "failed"

            # Mutate the matching entry in place. Using identity over the
            # entry dict is safe because we control both ends of the list.
            updated_delegations = []
            for d in state["delegations"]:
                if d.get("id") == entry_id:
                    updated_delegations.append(
                        {**d, "status": final_status, "result": result_text}
                    )
                else:
                    updated_delegations.append(d)
            state["delegations"] = updated_delegations
            yield encoder.encode(
                StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state)
            )

            yield encoder.encode(
                ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    tool_call_id=tc["id"],
                    content=result_text,
                )
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tc["id"],
                    "content": result_text,
                }
            )
        messages.append({"role": "user", "content": tool_results})
        # @endregion[subagents-delegation-flow]

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
