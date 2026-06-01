"""
MS Agent Framework agent backing the In-App HITL (frontend-tool + popup) demo.

The agent is a support assistant that processes customer-care requests
(refunds, account changes, escalations). Any action that materially
affects a customer MUST be confirmed by the human operator via the
frontend-provided `request_user_approval` tool.

The tool is defined on the frontend via `useFrontendTool` with an async
handler that opens a modal dialog OUTSIDE the chat surface. The handler
awaits the user's decision and resolves with
``{"approved": bool, "reason": str | None}``. This agent treats that
result as authoritative: if ``approved`` is ``True``, continue;
otherwise, stop and explain the decision back to the user.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from textwrap import dedent
from typing import Any

from ag_ui.core import BaseEvent
from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You are a support operations copilot working alongside a human operator
    inside an internal support console. The operator can see a list of open
    support tickets on the left side of their screen and is chatting with
    you on the right.

    Whenever the operator asks you to take an action that affects a
    customer -- for example: issuing a refund, updating a customer's plan,
    cancelling a subscription, escalating a ticket, or sending an apology
    credit -- you MUST first call the frontend-provided
    `request_user_approval` tool to obtain the operator's explicit consent.

    How to use `request_user_approval`:
    - `message`: a short, plain-English summary of the exact action you
      are about to take, including concrete numbers (e.g. '$50 refund to
      customer #12345').
    - `context`: optional extra context the operator might want to review
      (the ticket ID, the policy rule you're applying, etc.). Keep it to
      one or two short sentences.

    The tool returns an object of the shape
    `{"approved": boolean, "reason": string | null}`.
    - If `approved` is `true`: confirm in one short sentence that you are
      processing the action. You do not actually need to call any other
      tool -- this is a demo. Just acknowledge.
    - If `approved` is `false`: acknowledge the rejection in one short
      sentence and, if `reason` is non-empty, reflect the operator's
      reason back to them. Do NOT retry the action.

    Keep all chat replies to one or two short sentences. Never make up
    customer data -- always use whatever the operator told you in the
    prompt.
    """
).strip()


def _tool_call_ids(message: dict[str, Any]) -> set[str]:
    tool_calls = message.get("tool_calls") or message.get("toolCalls") or []
    if not isinstance(tool_calls, list):
        return set()

    ids: set[str] = set()
    for call in tool_calls:
        if isinstance(call, dict) and isinstance(call.get("id"), str):
            ids.add(call["id"])
    return ids


def _tool_result_ids(messages: list[dict[str, Any]], start_index: int) -> set[str]:
    ids: set[str] = set()
    for message in messages[start_index + 1 :]:
        if message.get("role") == "user":
            break
        if message.get("role") != "tool":
            continue
        call_id = message.get("tool_call_id") or message.get("toolCallId")
        if isinstance(call_id, str):
            ids.add(call_id)
    return ids


def _last_user_message_index(messages: list[dict[str, Any]]) -> int:
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            return index
    return -1


def _sanitize_approval_history(messages: Any) -> list[dict[str, Any]]:
    """Keep only the active approval tool pair; summarize older pairs via text."""
    if not isinstance(messages, list):
        return []

    typed_messages = [message for message in messages if isinstance(message, dict)]
    last_user_index = _last_user_message_index(typed_messages)

    clean: list[dict[str, Any]] = []
    for index, message in enumerate(typed_messages):
        if index < last_user_index:
            if message.get("role") == "tool":
                continue
            if message.get("role") == "assistant" and _tool_call_ids(message):
                continue
            clean.append(message)
            continue

        if message.get("role") == "assistant":
            call_ids = _tool_call_ids(message)
            if call_ids and not call_ids.issubset(
                _tool_result_ids(typed_messages, index)
            ):
                continue
        clean.append(message)
    return clean


class HitlInAppFrameworkAgent(AgentFrameworkAgent):
    """AgentFrameworkAgent that drops malformed historical approval tool calls."""

    async def run(  # type: ignore[override]
        self,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[BaseEvent, None]:
        patched_input = dict(input_data)
        patched_input["messages"] = _sanitize_approval_history(
            input_data.get("messages")
        )

        async for event in super().run(patched_input):
            yield event


def create_hitl_in_app_agent(chat_client: BaseChatClient) -> HitlInAppFrameworkAgent:
    """Instantiate the In-App HITL demo agent backed by Microsoft Agent Framework."""
    base_agent = Agent(
        client=chat_client,
        name="hitl_in_app_agent",
        instructions=SYSTEM_PROMPT,
        tools=[],
        default_options={"allow_multiple_tool_calls": False},
    )

    return HitlInAppFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentHitlInAppAgent",
        description=(
            "Support copilot that asks for explicit operator approval via a "
            "frontend-provided tool before taking any customer-affecting action."
        ),
        require_confirmation=False,
    )
