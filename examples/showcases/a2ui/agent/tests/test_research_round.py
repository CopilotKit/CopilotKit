from types import SimpleNamespace

from research_desk.agent import (
    RESEARCH_DONE,
    RESEARCHED_STATE_KEY,
    note_research,
    one_research_round,
)


def tool(name):
    return SimpleNamespace(name=name)


def context():
    return SimpleNamespace(state={})


def test_the_first_round_runs():
    ctx = context()
    assert one_research_round(tool("web_research"), {}, ctx) is None
    assert one_research_round(tool("find_images"), {}, ctx) is None


def test_after_a_round_with_results_research_answers_at_once():
    ctx = context()
    note_research(
        tool("web_research"),
        {},
        ctx,
        {"summary": "...", "sources": [{"url": "https://a"}]},
    )
    assert ctx.state[RESEARCHED_STATE_KEY] is True
    assert one_research_round(tool("web_research"), {}, ctx) == RESEARCH_DONE
    assert one_research_round(tool("find_images"), {}, ctx) == RESEARCH_DONE


def test_other_tools_are_never_held_back():
    ctx = context()
    note_research(tool("web_research"), {}, ctx, {"sources": [{"url": "https://a"}]})
    assert one_research_round(tool("GMAIL_SEND_EMAIL"), {}, ctx) is None


def test_a_round_that_came_back_empty_may_research_again():
    ctx = context()
    note_research(tool("web_research"), {}, ctx, {"error": "Search failed"})
    assert one_research_round(tool("web_research"), {}, ctx) is None
