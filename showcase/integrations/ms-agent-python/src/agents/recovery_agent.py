"""
MS Agent Framework agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as `a2ui_dynamic.py` (declarative-gen-ui), plus
an in-tool validate→retry loop so HEAL/EXHAUST pills exercise recovery without
LangGraph's `get_a2ui_tools`.

Backend-owned wiring: this agent OWNS `generate_a2ui`. The dedicated route at
`/api/copilotkit-a2ui-recovery` sets `injectA2UITool: false`.

Recovery loop (MAF-native, mirrors toolkit semantics for the probe):
  1. Secondary LLM is forced to call `render_a2ui` (shared aimock toolName
     with LG/ag2 design fixtures — private aliases get stolen by bare
     userMessage outer fixtures because aimock strips `context`).
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
    # Prefer the real user turn; never invent a keyword soup that could
    # collide with other demos' aimock fixtures (substring matching).
    return latest or context


def _design_once(client: Any, user_content: str, attempt: int) -> dict[str, Any]:
    """One secondary-LLM design attempt. Returns tool-call args or raises.

    Uses tool name `render_a2ui` so aimock first-match hits the shared
    HEAL/EXHAUST design fixtures (LG/ag2) keyed on toolName=render_a2ui
    + sequenceIndex. Do NOT append attempt markers to the user message —
    that would break userMessage substring matchers on the recovery pills.
    """
    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
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
    # Keep the user message identical across attempts so aimock
    # sequenceIndex can advance HEAL seq0 (invalid) → seq1 (valid).
    _ = attempt  # reserved for future logging / diagnostics
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    f"Generate a useful dashboard UI. Use catalogId='{CUSTOM_CATALOG_ID}'."
                ),
            },
            {"role": "user", "content": user_content},
        ],
        tools=[tool_schema],
        tool_choice={
            "type": "function",
            "function": {"name": "render_a2ui"},
        },
    )
    if not response.choices[0].message.tool_calls:
        raise RuntimeError("LLM did not call render_a2ui")
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
    # MUST include `a2ui_operations` (even empty) so the a2ui middleware emits
    # an `a2ui-surface` activity whose content the React renderer inspects for
    # status==="failed" (see A2UIMessageRenderer). Without the key, the tool
    # result is ignored and no "Couldn't generate the UI" card appears.
    return json.dumps(
        {
            "a2ui_operations": [],
            "status": "failed",
            "code": "a2ui_recovery_exhausted",
            "error": (
                f"Couldn't generate the UI after {MAX_ATTEMPTS} "
                f"validation attempt(s)."
            ),
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
