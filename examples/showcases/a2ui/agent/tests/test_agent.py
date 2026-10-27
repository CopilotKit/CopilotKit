from types import SimpleNamespace

from ag_ui.core import RunAgentInput, StateDeltaEvent, StateSnapshotEvent

from research_desk.agent import (
    DEFAULT_MODEL,
    _is_title_run,
    _without_internal_state,
    use_selected_model,
)


def run_input(messages, forwarded_props=None):
    return RunAgentInput.model_validate(
        {
            "threadId": "t",
            "runId": "r",
            "state": {},
            "messages": messages,
            "tools": [],
            "context": [],
            "forwardedProps": forwarded_props or {},
        }
    )


def test_the_thread_naming_run_is_told_apart_from_a_question():
    naming = run_input(
        [
            {"id": "s", "role": "system", "content": "Name this thread. Return JSON"},
            {"id": "u", "role": "user", "content": "user: how warm is it"},
        ]
    )
    question = run_input(
        [{"id": "u", "role": "user", "content": "how warm is it"}],
        {"model": DEFAULT_MODEL},
    )
    assert _is_title_run(naming)
    assert not _is_title_run(question)


def test_internal_state_keys_never_reach_the_client():
    snapshot = StateSnapshotEvent(
        snapshot={"icon": "leaf", "_ag_ui_context": [{"value": "x"}]}
    )
    assert _without_internal_state(snapshot).snapshot == {"icon": "leaf"}

    delta = StateDeltaEvent.model_validate(
        {
            "type": "STATE_DELTA",
            "delta": [
                {"op": "add", "path": "/icon", "value": "leaf"},
                {"op": "add", "path": "/_ag_ui_context", "value": []},
            ],
        }
    )
    assert [op.path for op in _without_internal_state(delta).delta] == ["/icon"]


def test_selected_model_applies_only_when_known():
    request = SimpleNamespace(model=None)
    use_selected_model(
        SimpleNamespace(state={"model": "gemini-3.1-pro-preview"}), request
    )
    assert request.model == "gemini-3.1-pro-preview"

    use_selected_model(SimpleNamespace(state={"model": "not-a-model"}), request)
    assert request.model == DEFAULT_MODEL
