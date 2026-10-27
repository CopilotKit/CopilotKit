"""Per-run cap on model calls, replacing AG2 0.x ``max_consecutive_auto_reply``.

AG2 1.x drives the tool loop until the model stops asking for tools and has no
built-in turn limit. Without one, a model that keeps calling tools loops for
the whole run: the log volume hits the platform rate limit, the service stops
answering health probes, and the watchdog kills it. That is the failure the
0.x caps were guarding against.

``loop_cap(n)`` lets the model be called at most ``n`` times per run. The next
call is short-circuited with a plain text reply and no tool calls, which ends
the loop. Middleware is instantiated per run, so the count resets every turn.
"""

from __future__ import annotations

import logging

from ag2.events import ModelMessage, ModelResponse
from ag2.middleware import BaseMiddleware, Middleware

logger = logging.getLogger(__name__)

LOOP_CAP_REPLY = "I stopped here because this request hit the tool-call limit."


class _LoopCap(BaseMiddleware):
    def __init__(self, event, context, *, max_llm_calls: int) -> None:
        super().__init__(event, context)
        self._max_llm_calls = max_llm_calls
        self._calls = 0

    async def on_llm_call(self, call_next, events, context) -> ModelResponse:
        if self._calls >= self._max_llm_calls:
            logger.warning("loop cap reached after %d model calls", self._calls)
            message = ModelMessage(LOOP_CAP_REPLY)
            # AGUIStream renders ModelMessage events, not the returned response.
            await context.send(message)
            return ModelResponse(message)
        self._calls += 1
        return await call_next(events, context)


def loop_cap(max_llm_calls: int) -> Middleware:
    if max_llm_calls < 1:
        raise ValueError("max_llm_calls must be at least 1")
    return Middleware(_LoopCap, max_llm_calls=max_llm_calls)
