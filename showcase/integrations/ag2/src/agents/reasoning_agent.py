"""AG2 reasoning agent — surfaces the model's reasoning as AG-UI events.

Backs two showcase cells (both share this one backend):
    - reasoning-custom   (custom amber ReasoningBlock slot)
    - reasoning-default  (CopilotKit's built-in reasoning card)

Mirrors `showcase/integrations/agno/src/agents/reasoning_agent.py`, adapted to
AG2 1.x. The agent is a plain `Agent`: when the model returns reasoning, AG2's
`AGUIStream` maps it to REASONING_MESSAGE_* events (role "reasoning") ahead of
the TEXT_MESSAGE_* answer — no custom route needed.

A reasoning item reaches the stream through its summary text, so the agent uses
the config from `_reasoning_summary.py`, which asks the model for one (the
aimock fixtures' `reasoning` field is delivered the same way).

The global httpx hook installed in agent_server.py forwards the inbound
`x-aimock-context` header onto the outbound OpenAI call so aimock matches the
ag2-scoped fixture.
"""

from __future__ import annotations

from ag2 import Agent
from ag2.ag_ui import AGUIStream
from fastapi import FastAPI

from ._loop_cap import loop_cap
from ._reasoning_summary import reasoning_config

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

MODEL = "gpt-5-mini"

agent = Agent(
    "reasoning_assistant",
    prompt=SYSTEM_PROMPT,
    config=reasoning_config(MODEL),
    middleware=[loop_cap(5)],
)

stream = AGUIStream(agent)

# FastAPI sub-app so agent_server.py can mount at /reasoning. The HttpAgent
# posts to ``/reasoning/`` (route.ts ``createAgent("/reasoning/")``), so the
# outer Mount strips ``/reasoning`` and this inner Mount at ``/`` resolves
# the endpoint.
reasoning_app = FastAPI(title="AG2 Reasoning Agent")
reasoning_app.mount("/", stream.build_asgi())
