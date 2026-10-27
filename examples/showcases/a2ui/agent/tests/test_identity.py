import asyncio
from types import SimpleNamespace

from ag_ui.core import RunAgentInput

from research_desk.identity import (
    ANONYMOUS_USER,
    SECRET_HEADER,
    USER_HEADER,
    USER_STATE_KEY,
    user_of,
    verified_user_state,
)


def run_input(state):
    return RunAgentInput.model_validate(
        {
            "threadId": "t",
            "runId": "r",
            "state": state,
            "messages": [],
            "tools": [],
            "context": [],
            "forwardedProps": {},
        }
    )


def request(headers):
    return SimpleNamespace(headers=headers)


def resolve(headers, state):
    input = run_input(state)
    merged = asyncio.run(verified_user_state(request(headers), input))
    return user_of(input.model_copy(update={"state": merged}))


def test_the_runtime_header_names_the_user(monkeypatch):
    monkeypatch.delenv("AGENT_SHARED_SECRET", raising=False)
    assert resolve({USER_HEADER: "user_123"}, {}) == "user_123"


def test_a_client_cannot_name_itself_in_state(monkeypatch):
    monkeypatch.delenv("AGENT_SHARED_SECRET", raising=False)
    spoofed = {USER_STATE_KEY: "someone_else", "model": "gemini-3.8-flash"}
    assert resolve({USER_HEADER: "user_123"}, spoofed) == "user_123"
    assert resolve({}, spoofed) == ANONYMOUS_USER


def test_with_a_secret_only_the_runtime_is_trusted(monkeypatch):
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    assert resolve({USER_HEADER: "user_123"}, {}) == ANONYMOUS_USER
    assert (
        resolve({USER_HEADER: "user_123", SECRET_HEADER: "nope"}, {}) == ANONYMOUS_USER
    )
    assert resolve({USER_HEADER: "user_123", SECRET_HEADER: "s3cret"}, {}) == "user_123"
