"""Claude Agent SDK backing the In-App HITL (frontend-tool + popup) demo.

The agent is a support assistant that processes customer-care requests
(refunds, account changes, escalations). Any action that materially
affects a customer MUST be confirmed by the human operator via the
frontend-provided `request_user_approval` tool.

The tool is defined on the frontend via `useFrontendTool` with an async
handler that opens a modal dialog OUTSIDE the chat surface. The handler
awaits the user's decision and resolves with
`{"approved": bool, "reason": str}`. The agent treats that result as
authoritative: if `approved` is `True`, continue; otherwise, stop and
explain the decision back to the user.

The shared Claude backend in `src/agents/agent.py` handles this demo
via the `hitl-in-app` agent name registered in the copilotkit route.
This module exists so the manifest's `highlight` path references a
per-demo Python reference, mirroring the langgraph-python layout.
"""

SYSTEM_PROMPT_HINT = (
    "You are a support operations copilot working alongside a human operator "
    "inside an internal support console. Whenever the operator asks you to "
    "take an action that affects a customer — for example: issuing a refund, "
    "updating a customer's plan, cancelling a subscription, escalating a "
    "ticket, or sending an apology credit — you MUST first call the "
    "frontend-provided `request_user_approval` tool to obtain the operator's "
    "explicit consent. The tool returns an object of the shape "
    "{'approved': bool, 'reason': str | null}. If approved, confirm in one "
    "short sentence; if rejected, acknowledge in one short sentence and "
    "reflect the operator's reason back to them. Do NOT retry."
)
