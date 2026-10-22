"""Timing must observe a stream without buffering, leaking text, or mixing runs."""

import asyncio
from types import SimpleNamespace

from ag_ui.core import RunFinishedEvent, RunStartedEvent, TextMessageContentEvent
from google.adk.models.google_llm import Gemini
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from src.timing import TimedGemini, current_timing, trace_run


async def test_timing_preserves_stream_and_ignores_thoughts(monkeypatch):
    async def generate(self, llm_request, stream=False):
        yield LlmResponse(
            content=types.Content(parts=[types.Part(text="private", thought=True)]),
            partial=True,
        )
        yield LlmResponse(
            content=types.Content(parts=[types.Part(text="hello")]), partial=True
        )

    monkeypatch.setattr(Gemini, "generate_content_async", generate)
    model = TimedGemini(model="gemini-3.8-flash")
    incoming = SimpleNamespace(run_id="run", thread_id="thread")
    original = []

    async def source():
        event = RunStartedEvent(run_id="run", thread_id="thread")
        original.append(event)
        yield event
        async for response in model.generate_content_async(None, stream=True):
            part = response.content.parts[0]
            if not part.thought:
                event = TextMessageContentEvent(message_id="message", delta=part.text)
                original.append(event)
                yield event
        event = RunFinishedEvent(run_id="run", thread_id="thread")
        original.append(event)
        yield event

    events = [
        event
        async for event in trace_run(
            source(), incoming, model.model, "json", "markdown"
        )
    ]
    assert [event for event in events if event.type != "CUSTOM"] == original
    assert events[0] is original[0]
    assert events[-1] is original[-1]
    report = [event.value for event in events if event.type == "CUSTOM"][-1]
    call = report["model_calls"][0]
    assert call["request_ms"] <= call["first_text_ms"] <= report["ag_ui_first_text_ms"]
    assert report["ag_ui_text_chunks"] == 1
    assert "private" not in str(report) and "hello" not in str(report)
    assert current_timing.get() is None


async def test_concurrent_runs_and_cancellation_are_isolated():
    async def collect(run_id):
        async def source():
            yield RunStartedEvent(run_id=run_id, thread_id=run_id)
            await asyncio.sleep(0)
            assert current_timing.get().run_id == run_id
            yield RunFinishedEvent(run_id=run_id, thread_id=run_id)

        return [
            event
            async for event in trace_run(
                source(),
                SimpleNamespace(run_id=run_id, thread_id=run_id),
                "model",
                "json",
                "markdown",
            )
        ]

    a, b = await asyncio.gather(collect("a"), collect("b"))
    assert a[-2].value["run_id"] == "a"
    assert b[-2].value["run_id"] == "b"
    closed = False

    async def source():
        nonlocal closed
        try:
            yield RunStartedEvent(run_id="cancel", thread_id="cancel")
        finally:
            closed = True

    stream = trace_run(
        source(),
        SimpleNamespace(run_id="cancel", thread_id="cancel"),
        "model",
        "json",
        "markdown",
    )
    await anext(stream)
    await stream.aclose()
    assert closed
    assert current_timing.get() is None
