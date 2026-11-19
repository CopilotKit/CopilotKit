"""Who the agent is working for on a run.

The app's runtime signs the reader in (Clerk) and names them in a header on
every run it sends here. The agent trusts that header only: a user id a
client puts in AG-UI state is overwritten, so nobody can act as someone else
by editing state. With AGENT_SHARED_SECRET set, the header also has to come
with the runtime's secret, so a caller that reaches this server directly is
anonymous.

The user id becomes the ADK session's user, and the key under which the
reader's connected apps (Composio) are looked up.
"""

from __future__ import annotations

import hmac
import os

from ag_ui.core import RunAgentInput
from fastapi import Request

USER_HEADER = "x-desk-user"
SECRET_HEADER = "x-desk-agent-secret"
# Underscore keys never leave the agent; see `_without_internal_state`.
USER_STATE_KEY = "_desk_user"
ANONYMOUS_USER = "anonymous"


def _trusted(request: Request) -> bool:
    secret = os.getenv("AGENT_SHARED_SECRET")
    if not secret:
        return True
    sent = request.headers.get(SECRET_HEADER, "")
    return hmac.compare_digest(sent.encode(), secret.encode())


async def verified_user_state(request: Request, input: RunAgentInput) -> dict:
    """The run's state with the signed-in user written over whatever the
    client sent under the same key."""
    state = dict(input.state) if isinstance(input.state, dict) else {}
    user = request.headers.get(USER_HEADER) if _trusted(request) else None
    state[USER_STATE_KEY] = user or ANONYMOUS_USER
    return state


def user_of(input: RunAgentInput) -> str:
    state = input.state if isinstance(input.state, dict) else {}
    user = state.get(USER_STATE_KEY)
    return user if isinstance(user, str) and user else ANONYMOUS_USER
