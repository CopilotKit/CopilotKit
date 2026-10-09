from copilotkit_runtime.finalizer import EventFinalizer


def test_incomplete_stream_closes_open_messages_and_tools_without_success():
    state = EventFinalizer()
    state.observe({"type": "RUN_STARTED", "threadId": "thread", "runId": "run"})
    state.observe({"type": "TEXT_MESSAGE_START", "messageId": "message"})
    state.observe({"type": "TOOL_CALL_START", "toolCallId": "tool"})
    events = state.finish()
    assert [event["type"] for event in events] == [
        "TEXT_MESSAGE_END",
        "TOOL_CALL_END",
        "TOOL_CALL_RESULT",
        "RUN_ERROR",
    ]
    assert events[-1]["code"] == "INCOMPLETE_STREAM"


def test_authorized_stop_is_finished_and_existing_terminal_is_not_modified():
    state = EventFinalizer()
    state.observe({"type": "RUN_STARTED", "threadId": "thread", "runId": "run"})
    state.observe({"type": "TEXT_MESSAGE_START", "messageId": "message"})
    assert state.finish(stop_requested=True)[-1] == {"type": "RUN_FINISHED"}
    state.observe({"type": "RUN_FINISHED"})
    assert state.finish() == []
