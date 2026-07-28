"""
MS Agent Framework agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as `a2ui_dynamic.py` (declarative-gen-ui), plus
an in-tool validate→retry loop so HEAL/EXHAUST pills exercise recovery without
LangGraph's `get_a2ui_tools`.

Backend-owned wiring: this agent OWNS `generate_a2ui`. The dedicated route at
`/api/copilotkit-a2ui-recovery` sets `injectA2UITool: false`.

Recovery loop (MAF-native, mirrors toolkit semantics for the probe):
  1. Secondary LLM is forced to call `_design_a2ui_surface`.
  2. Components are validated (root present; every child id resolves).
  3. Invalid → retry up to max_attempts (default 3).
  4. Still invalid → return hard-fail envelope
     `{ "status": "failed", "error": "...", "attempts": [...] }` which the
     A2UI renderer surfaces as "Couldn't generate the UI".

Catalog id: `declarative-gen-ui-catalog` (shared with declarative-gen-ui).
Mounted at `/a2ui_recovery` by `agent_server.py`.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Annotated, Any

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

from tools import build_a2ui_operations_from_tool_call

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"
MAX_ATTEMPTS = 3


def _validate_components(components: list[Any]) -> list[str]:
    """Return a list of validation errors (empty = valid)."""
    errors: list[str] = []
    if not components:
        return ["components array is empty"]
    by_id: dict[str, dict[str, Any]] = {}
    for c in components:
        if not isinstance(c, dict):
            errors.append("component entry is not an object")
            continue
        cid = c.get("id")
        if not cid or not isinstance(cid, str):
            errors.append("component missing string id")
            continue
        by_id[cid] = c
    if "root" not in by_id:
        errors.append("no component with id 'root'")
    for cid, c in by_id.items():
        children = c.get("children")
        if isinstance(children, list):
            for child in children:
                if isinstance(child, str) and child not in by_id:
                    errors.append(f"component '{cid}' references missing child '{child}'")
        child = c.get("child")
        if isinstance(child, str) and child not in by_id:
            errors.append(f"component '{cid}' references missing child '{child}'")
    return errors


def _latest_user_message(session: Any, context: str) -> str:
    latest = ""
    if session is not None:
        try:
            messages = list(getattr(session, "input_messages", []) or [])
            for msg in reversed(messages):
                if getattr(msg, "role", None) == "user":
                    text = getattr(msg, "text", None) or str(
                        getattr(msg, "content", "") or ""
                    )
                    if text:
                        latest = text
                        break
        except Exception:
            latest = ""
    return (
        latest
        or context
        or "Q2 revenue summary, self-correct malformed first attempt, "
        "validation fallback report."
    )


def _design_once(client: Any, user_content: str, attempt: int) -> dict[str, Any]:
    """One secondary-LLM design attempt. Returns tool-call args or raises."""
    tool_schema = {
        "type": "function",
        "function": {
            "name": "_design_a2ui_surface",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
            },
        },
    }
    # Attempt number is folded into the user message so aimock can key
    # HEAL seq0 invalid → seq1 valid via sequenceIndex OR distinct prompts
    # when sequenceIndex is unavailable on this transport.
    attempt_hint = f"\n[recovery_attempt={attempt}]"
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    f"Generate a useful dashboard UI. Use catalogId='{CUSTOM_CATALOG_ID}'."
                ),
            },
            {"role": "user", "content": user_content + attempt_hint},
        ],
        tools=[tool_schema],
        tool_choice={
            "type": "function",
            "function": {"name": "_design_a2ui_surface"},
        },
    )
    if not response.choices[0].message.tool_calls:
        raise RuntimeError("LLM did not call _design_a2ui_surface")
    tool_call = response.choices[0].message.tool_calls[0]
    raw_args = tool_call.function.arguments
    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
    args.setdefault("catalogId", CUSTOM_CATALOG_ID)
    return args


@tool(
    name="generate_a2ui",
    description=(
        "Generate dynamic A2UI components based on the conversation. "
        "A secondary LLM designs the UI schema and data. Handles rendering "
        "and automatic recovery internally."
    ),
)
def generate_a2ui(
    context: Annotated[
        str,
        Field(default="", description="Conversation context to generate UI from."),
    ] = "",
    session: Any = None,
) -> str:
    """Generate A2UI with validate→retry recovery loop."""
    from openai import OpenAI

    user_content = _latest_user_message(session, context)
    client = OpenAI()
    attempts: list[dict[str, Any]] = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            args = _design_once(client, user_content, attempt)
        except Exception as exc:  # noqa: BLE001 — surface as attempt failure
            attempts.append(
                {"attempt": attempt, "ok": False, "errors": [str(exc)]}
            )
            continue

        components = args.get("components") or []
        if not isinstance(components, list):
            components = []
        errors = _validate_components(components)
        attempts.append(
            {
                "attempt": attempt,
                "ok": len(errors) == 0,
                "errors": errors,
            }
        )
        if errors:
            continue

        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)

    # Recovery exhausted — hard-fail envelope for A2UIRecoveryFailure UI.
    return json.dumps(
        {
            "status": "failed",
            "error": "a2ui_recovery_exhausted",
            "message": "Couldn't generate the UI after validation retries.",
            "attempts": attempts,
            "maxAttempts": MAX_ATTEMPTS,
        }
    )


SYSTEM_PROMPT = dedent(
    """
    You are the embedded sales analyst for Vantage Threads, the fictional
    B2B apparel company described in your App Context. Answer every business
    question by calling `generate_a2ui` to draw a rich visual surface, and
    keep the chat reply to one short sentence. Ground every number in the
    sales dataset from your App Context. `generate_a2ui` handles the
    rendering — and its automatic recovery — for you.
    """
).strip()


def create_recovery_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed A2UI recovery agent."""
    base_agent = Agent(
        client=chat_client,
        name="a2ui_recovery_agent",
        instructions=SYSTEM_PROMPT,
        tools=[generate_a2ui],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description=(
            "Dynamic A2UI generator with validate→retry recovery loop "
            "(backend-owned generate_a2ui)."
        ),
        require_confirmation=False,
    )
