"""Demo diagnostics, not an SDK patch. Never record prompt or response content."""

import logging
from contextlib import aclosing
from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter

from ag_ui.core import CustomEvent
from google.adk.models.google_llm import Gemini

logger = logging.getLogger(__name__)


@dataclass
class RunTiming:
    run_id: str
    thread_id: str
    model: str
    format: str
    transport: str
    started: float = field(default_factory=perf_counter)
    marks: dict = field(default_factory=dict)
    calls: list = field(default_factory=list)
    chunks: int = 0

    def elapsed(self):
        return round((perf_counter() - self.started) * 1000, 3)

    def snapshot(self, phase):
        return {
            "run_id": self.run_id,
            "thread_id": self.thread_id,
            "model": self.model,
            "format": self.format,
            "transport": self.transport,
            "phase": phase,
            "elapsed_ms": self.elapsed(),
            **self.marks,
            "model_calls": [dict(call) for call in self.calls],
            "ag_ui_text_chunks": self.chunks,
        }


current_timing: ContextVar[RunTiming | None] = ContextVar("demo_timing", default=None)


class TimedGemini(Gemini):
    """Observe ADK's model entry and response chunks without changing generation."""

    async def generate_content_async(self, llm_request, stream=False):
        timing = current_timing.get()
        call = None
        if timing:
            # This is the ADK model entry, before SDK preprocessing/network I/O;
            # it is not a claim about the instant the HTTP request hits the wire.
            call = {"request_ms": timing.elapsed(), "stream": stream}
            timing.calls.append(call)
        try:
            async with aclosing(
                super().generate_content_async(llm_request, stream=stream)
            ) as responses:
                async for response in responses:
                    if timing and call is not None:
                        call.setdefault("first_response_ms", timing.elapsed())
                        for part in (
                            response.content.parts if response.content else []
                        ) or []:
                            if part.text and not part.thought:
                                call.setdefault("first_text_ms", timing.elapsed())
                            if part.function_call:
                                call.setdefault("first_tool_call_ms", timing.elapsed())
                    yield response
        finally:
            if timing and call is not None:
                call["end_ms"] = timing.elapsed()


async def trace_run(source, incoming, model, format, transport):
    timing = RunTiming(incoming.run_id, incoming.thread_id, model, format, transport)
    token = current_timing.set(timing)
    try:
        async with aclosing(source) as events:
            async for event in events:
                first_text = False
                if event.type == "RUN_STARTED":
                    timing.marks.setdefault("run_started_ms", timing.elapsed())
                elif event.type == "TEXT_MESSAGE_CONTENT":
                    first_text = timing.chunks == 0
                    timing.chunks += 1
                    timing.marks.setdefault("ag_ui_first_text_ms", timing.elapsed())
                    timing.marks["ag_ui_last_text_ms"] = timing.elapsed()
                elif event.type == "TOOL_CALL_ARGS":
                    timing.marks.setdefault(
                        "ag_ui_first_tool_args_ms", timing.elapsed()
                    )
                if event.type in ("RUN_FINISHED", "RUN_ERROR"):
                    yield CustomEvent(
                        name="adk_demo_timing", value=timing.snapshot(event.type)
                    )
                yield event
                # Send the text first; diagnostics must not hold it up.
                if first_text:
                    yield CustomEvent(
                        name="adk_demo_timing", value=timing.snapshot("first_text")
                    )
    finally:
        logger.info("adk_demo_timing %s", timing.snapshot("closed"))
        current_timing.reset(token)
