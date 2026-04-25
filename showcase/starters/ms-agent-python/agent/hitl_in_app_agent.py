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

from textwrap import dedent

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

def create_hitl_in_app_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the In-App HITL demo agent backed by Microsoft Agent Framework."""
    base_agent = Agent(
        client=chat_client,
        name="hitl_in_app_agent",
        instructions=SYSTEM_PROMPT,
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentHitlInAppAgent",
        description=(
            "Support copilot that asks for explicit operator approval via a "
            "frontend-provided tool before taking any customer-affecting action."
        ),
        require_confirmation=False,
    )
