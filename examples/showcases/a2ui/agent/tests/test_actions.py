import asyncio
from types import SimpleNamespace

from google.adk.tools import FunctionTool

from research_desk import actions
from research_desk.actions import (
    APP_TOOLS,
    CONFIRMED_TOOLS,
    ConnectedAppsToolset,
    with_confirmation,
)
from research_desk.identity import ANONYMOUS_USER


def tool(name):
    def run(**kwargs):
        return {"successful": True}

    run.__name__ = name
    return FunctionTool(run)


def requires_confirmation(tool):
    return asyncio.run(tool.check_require_confirmation({}, None))


def test_only_actions_that_act_for_the_reader_ask_first():
    send, fetch, draft = with_confirmation(
        [
            tool("GMAIL_SEND_EMAIL"),
            tool("GMAIL_FETCH_EMAILS"),
            tool("GMAIL_CREATE_EMAIL_DRAFT"),
        ]
    )
    assert requires_confirmation(send)
    assert not requires_confirmation(fetch)
    assert not requires_confirmation(draft)


def test_every_confirmed_tool_is_one_the_agent_loads():
    loaded = {slug for slugs in APP_TOOLS.values() for slug in slugs}
    assert CONFIRMED_TOOLS <= loaded


def context(user_id):
    return SimpleNamespace(user_id=user_id)


def test_no_tools_without_a_key_or_a_reader(monkeypatch):
    toolset = ConnectedAppsToolset()
    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
    assert asyncio.run(toolset.get_tools(context("user_123"))) == []
    monkeypatch.setenv("COMPOSIO_API_KEY", "key")
    assert asyncio.run(toolset.get_tools(context(ANONYMOUS_USER))) == []
    assert asyncio.run(toolset.get_tools(None)) == []


def test_tools_are_loaded_per_reader_and_cached(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "key")
    loads = []
    monkeypatch.setattr(
        actions, "_load_tools", lambda user: loads.append(user) or [tool(user)]
    )
    toolset = ConnectedAppsToolset()
    first = asyncio.run(toolset.get_tools(context("ada")))
    again = asyncio.run(toolset.get_tools(context("ada")))
    other = asyncio.run(toolset.get_tools(context("grace")))
    assert loads == ["ada", "grace"]
    assert first is again and first[0].name == "ada" and other[0].name == "grace"


def test_a_failed_load_keeps_the_desk_answering(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "key")

    def fail(user):
        raise RuntimeError("Composio is down")

    monkeypatch.setattr(actions, "_load_tools", fail)
    assert asyncio.run(ConnectedAppsToolset().get_tools(context("ada"))) == []
