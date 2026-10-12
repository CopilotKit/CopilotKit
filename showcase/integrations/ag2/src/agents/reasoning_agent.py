"""AG2 reasoning agent — surfaces the model's reasoning as AG-UI events.

Backs two showcase cells (both share this one backend):
    - reasoning-custom   (custom amber ReasoningBlock slot)
    - reasoning-default  (CopilotKit's built-in reasoning card)

Mirrors `showcase/integrations/agno/src/agents/reasoning_agent.py`, adapted to
AG2 1.x. The agent is a plain `Agent`: when the model returns reasoning, AG2's
`AGUIStream` maps it to REASONING_MESSAGE_* events (role "reasoning") ahead of
the TEXT_MESSAGE_* answer — no custom route needed.

A reasoning item reaches the stream through its summary text. AG2 1.1.2's
`OpenAIResponsesConfig` has no `reasoning` option, so the request is given
`reasoning.summary` through the config's `http_client` (the aimock fixtures'
`reasoning` field is delivered the same way).

The global httpx hook installed in agent_server.py forwards the inbound
`x-aimock-context` header onto the outbound OpenAI call so aimock matches the
ag2-scoped fixture.
"""

from __future__ import annotations

import json

import httpx2
from ag2 import Agent
from ag2.ag_ui import AGUIStream
from ag2.config.openai import OpenAIResponsesConfig
from fastapi import FastAPI

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

MODEL = "gpt-5-mini"


async def _request_reasoning_summary(request: httpx2.Request) -> None:
    """Add `reasoning.summary` to the outgoing Responses API request body."""
    if request.method != "POST" or not request.url.path.endswith("/responses"):
        return
    body = json.loads(request.content)
    body["reasoning"] = {"effort": "medium", "summary": "auto"}
    data = json.dumps(body).encode()
    request.headers["content-length"] = str(len(data))
    request._content = data
    request.stream = httpx2.ByteStream(data)

agent = Agent(
    "reasoning_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIResponsesConfig(
        model=MODEL,
        streaming=True,
        http_client=httpx2.AsyncClient(
            event_hooks={"request": [_request_reasoning_summary]},
            timeout=httpx2.Timeout(600.0),
        ),
    ),
)

stream = AGUIStream(agent)

# FastAPI sub-app so agent_server.py can mount at /reasoning. The HttpAgent
# posts to ``/reasoning/`` (route.ts ``createAgent("/reasoning/")``), so the
# outer Mount strips ``/reasoning`` and this inner Mount at ``/`` resolves
# the endpoint.
reasoning_app = FastAPI(title="AG2 Reasoning Agent")
reasoning_app.mount("/", stream.build_asgi())
