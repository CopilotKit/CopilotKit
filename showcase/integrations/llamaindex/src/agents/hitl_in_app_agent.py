"""LlamaIndex agent backing the In-App HITL (frontend-tool + popup) demo.

The agent is a support assistant that processes customer-care requests.
Any action that materially affects a customer MUST be confirmed by the
human operator via the frontend-provided `request_user_approval` tool.

The tool is defined on the frontend via `useFrontendTool` with an async
handler that opens a modal dialog OUTSIDE the chat surface. The AG-UI
workflow router picks up frontend-provided tools from the CopilotKit
request.

Mirrors `langgraph-python/src/agents/hitl_in_app.py`.

NOTE: Uses FixedAGUIChatWorkflow from hitl_in_chat_agent to fix three
upstream library bugs (duplicate tool-call rendering, missing
parent_message_id, and incorrect tool-result message roles). See
hitl_in_chat_agent.py module docstring for details.
"""

from __future__ import annotations

import os

from llama_index.core.tools import FunctionTool
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from agents.hitl_in_chat_agent import FixedAGUIChatWorkflow

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


def _request_user_approval_stub(message: str, context: str = "") -> str:
    """Ask the operator to approve or reject an action before taking it.

    The approval dialog is rendered on the frontend via useFrontendTool.
    This stub satisfies the AGUIChatWorkflow tool registry so the proper
    AG-UI TOOL_CALL_CHUNK events are emitted; CopilotKit intercepts the
    call and opens the modal dialog.
    """
    return ""


_request_user_approval_tool = FunctionTool.from_defaults(
    fn=_request_user_approval_stub,
    name="request_user_approval",
    description=(
        "Ask the operator to approve or reject an action before you take it. "
        "Returns { approved: boolean, reason?: string }."
    ),
)

SYSTEM_PROMPT = (
    "You are a support operations copilot working alongside a human operator "
    "inside an internal support console. The operator can see a list of open "
    "support tickets on the left side of their screen and is chatting with "
    "you on the right.\n"
    "\n"
    "Whenever the operator asks you to take an action that affects a "
    "customer — for example: issuing a refund, updating a customer's plan, "
    "cancelling a subscription, escalating a ticket, or sending an apology "
    "credit — you MUST first call the frontend-provided "
    "`request_user_approval` tool to obtain the operator's explicit consent.\n"
    "\n"
    "How to use `request_user_approval`:\n"
    "- `message`: a short, plain-English summary of the exact action you "
    "  are about to take, including concrete numbers (e.g. '$50 refund to "
    "  customer #12345').\n"
    "- `context`: optional extra context the operator might want to review "
    "  (the ticket ID, the policy rule you're applying, etc.). Keep it to "
    "  one or two short sentences.\n"
    "\n"
    "The tool returns an object of the shape "
    '`{"approved": boolean, "reason": string | null}`.\n'
    "- If `approved` is `true`: confirm in one short sentence that you are "
    "  processing the action.\n"
    "- If `approved` is `false`: acknowledge the rejection in one short "
    "  sentence.\n"
    "\n"
    "Keep all chat replies to one or two short sentences."
)


async def _workflow_factory():
    return FixedAGUIChatWorkflow(
        llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
        frontend_tools=[_request_user_approval_tool],
        backend_tools=[],
        system_prompt=SYSTEM_PROMPT,
        initial_state={},
    )


hitl_in_app_router = get_ag_ui_workflow_router(
    workflow_factory=_workflow_factory,
)
