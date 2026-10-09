"""Request preparation must not turn application context into user history."""

from ag_ui.core import Context, RunAgentInput, ToolMessage, UserMessage
from agents.agent import with_state_context


def make_input(state=None):
    return RunAgentInput(
        thread_id="thread",
        run_id="run",
        state=state or {},
        tools=[],
        forwarded_props={},
        messages=[UserMessage(id="user", role="user", content="Who am I?")],
        context=[Context(description="Application catalog", value="catalog" * 9000)],
    )


def test_repeated_runs_preserve_user_text_and_do_not_accumulate_context():
    request = make_input({"preferences": {"name": "Ada"}, "todos": ["Follow up"]})
    for _ in range(8):
        prepared = with_state_context(request)
        assert prepared.messages == request.messages
        assert len(prepared.context) == 3
        assert "Ada" in prepared.context[1].value
        assert "Follow up" in prepared.context[2].value
    assert len(request.context) == 1
    assert request.messages[0].content == "Who am I?"


def test_current_state_is_available_on_tool_continuation():
    request = make_input({"preferences": {"name": "Grace"}, "todos": []})
    request.messages.append(
        ToolMessage(
            id="answer",
            role="tool",
            tool_call_id="approval",
            content="approved",
        )
    )
    prepared = with_state_context(request)
    assert prepared.messages == request.messages
    assert "Grace" in prepared.context[1].value
    assert prepared.context[2].value == "[]"
    assert len(with_state_context(make_input()).context) == 1


def test_factory_routes_context_through_wrapper_without_message_builder(monkeypatch):
    import asyncio
    from agents.agent import build_showcase_agent

    wrapper = build_showcase_agent(model=object())
    assert "state_context_builder" not in wrapper._delegate.kwargs["config"].kwargs
    captured = []

    async def run(input_data):
        captured.append(input_data)
        if False:
            yield None

    monkeypatch.setattr(wrapper._delegate, "run", run, raising=False)
    request = make_input({"preferences": {"name": "Ada"}})

    async def collect():
        return [event async for event in wrapper.run(request)]

    asyncio.run(collect())
    assert len(captured) == 1
    assert captured[0].messages == request.messages
    assert captured[0].context[0] == request.context[0]
    assert "Ada" in captured[0].context[1].value
