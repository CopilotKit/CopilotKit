import json

import pytest

import copilotkit.langgraph as lg


def test_copilotkit_interrupt_resume_string(monkeypatch):
    monkeypatch.setattr(lg, "interrupt", lambda payload: "")
    answer, resp = lg.copilotkit_interrupt(message="{}")
    assert answer == ""
    assert resp == ""


def test_copilotkit_interrupt_resume_dict(monkeypatch):
    monkeypatch.setattr(lg, "interrupt", lambda payload: {"ok": True})
    answer, resp = lg.copilotkit_interrupt(message="{}")
    assert json.loads(answer)["ok"] is True
    assert resp == {"ok": True}


def test_copilotkit_interrupt_resume_message_list(monkeypatch):
    class Msg:
        def __init__(self, content: str):
            self.content = content

    monkeypatch.setattr(lg, "interrupt", lambda payload: [Msg("a"), Msg("b")])
    answer, resp = lg.copilotkit_interrupt(message="{}")
    assert answer == "b"
    assert len(resp) == 2


def test_copilotkit_interrupt_does_not_swallow_interrupt(monkeypatch):
    class DummyGraphInterrupt(Exception):
        pass

    def raising(_payload):
        raise DummyGraphInterrupt("interrupt")

    monkeypatch.setattr(lg, "interrupt", raising)
    with pytest.raises(DummyGraphInterrupt):
        lg.copilotkit_interrupt(message="{}")

