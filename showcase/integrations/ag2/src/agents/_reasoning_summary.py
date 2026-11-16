"""Responses config that asks the model for a reasoning summary.

A reasoning item reaches AG-UI's REASONING_MESSAGE_* events through its summary
text, and OpenAI only returns one when the request sets `reasoning.summary`.
`OpenAIResponsesConfig` in AG2 1.1.2 (the version pinned in requirements.txt)
has no `reasoning` option, so it is added to the request body through the
config's `http_client`. AG2 1.2.1 adds the option; drop this module when the
pin moves there.

The hook rewrites the private `httpx2.Request._content` (checked against
httpx2 2.13.1, which AG2 1.1.2's `openai` extra pulls in): an event hook cannot
replace the request, and the public `content` is a read-only view of that
cached body.
"""

from __future__ import annotations

import json

import httpx2
from ag2.config.openai import OpenAIResponsesConfig


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


def reasoning_config(model: str) -> OpenAIResponsesConfig:
    return OpenAIResponsesConfig(
        model=model,
        streaming=True,
        http_client=httpx2.AsyncClient(
            event_hooks={"request": [_request_reasoning_summary]},
            timeout=httpx2.Timeout(600.0),
        ),
    )
