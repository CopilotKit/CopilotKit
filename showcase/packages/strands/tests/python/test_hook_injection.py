"""Tests for _HookInjectingAgentDict in src/agents/agent.py.

Verifies:
  * hook is injected when an Agent is inserted via ``__setitem__``,
    ``update()``, ``setdefault()``, and ``|=`` (``__ior__``),
  * existing entries are preserved when the factory swaps in the dict,
  * no double-injection on re-insert of the same thread_id.
"""

from __future__ import annotations

import pytest


class _FakeHookRegistry:
    """Minimal stand-in for strands' HookRegistry exposing what the cap hook uses."""

    def __init__(self):
        self._hook_providers = []
        self._callbacks = []

    def add_hook(self, provider):
        self._hook_providers.append(provider)
        provider.register_hooks(self)

    def add_callback(self, event_cls, cb):
        self._callbacks.append((event_cls, cb))


class _FakeAgent:
    """Duck-typed stand-in for strands.Agent — must pass isinstance(Agent) check.

    We monkey-patch ``agents.agent.Agent`` in each test to our fake class so
    ``isinstance(value, Agent)`` inside the dict routes correctly.
    """

    def __init__(self, label: str = ""):
        self.label = label
        self.hooks = _FakeHookRegistry()


@pytest.fixture
def patched_agent(monkeypatch):
    """Swap ``agents.agent.Agent`` for ``_FakeAgent`` for the duration of the test."""
    import agents.agent as agent_mod

    monkeypatch.setattr(agent_mod, "Agent", _FakeAgent)
    return agent_mod


def _count_cap_hooks(agent, cap_hook_cls) -> int:
    return sum(1 for p in agent.hooks._hook_providers if isinstance(p, cap_hook_cls))


def test_setitem_injects_hook(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("t1")

    d["thread-1"] = a

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1


def test_update_injects_hook(patched_agent):
    """``dict.update`` bypasses ``__setitem__`` in CPython's bulk path;
    the override must still run injection."""
    d = patched_agent._HookInjectingAgentDict()
    a, b = _FakeAgent("a"), _FakeAgent("b")

    d.update({"thread-a": a, "thread-b": b})

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1
    assert _count_cap_hooks(b, patched_agent._ToolCallCapHook) == 1


def test_update_with_kwargs_injects_hook(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("kw")

    d.update(threadk=a)

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1


def test_update_with_iterable_of_pairs_injects_hook(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("p")

    d.update([("thread-p", a)])

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1


def test_setdefault_injects_hook(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("sd")

    d.setdefault("thread-sd", a)

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1


def test_setdefault_existing_key_skips_default(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    first = _FakeAgent("first")
    second = _FakeAgent("second")

    d["x"] = first
    result = d.setdefault("x", second)

    # setdefault returns the existing value and never inserts second.
    assert result is first
    assert _count_cap_hooks(second, patched_agent._ToolCallCapHook) == 0


def test_ior_injects_hook(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("ior")

    d |= {"thread-ior": a}

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1


def test_existing_entries_preserved_on_wrap(patched_agent):
    """When ``build_showcase_agent`` copies the original dict into the
    injecting dict, pre-existing entries must survive (and gain the hook)."""
    original = {"preexisting-thread": _FakeAgent("pre")}
    hook_dict = patched_agent._HookInjectingAgentDict()
    hook_dict.update(original)

    assert "preexisting-thread" in hook_dict
    assert hook_dict["preexisting-thread"].label == "pre"
    assert _count_cap_hooks(hook_dict["preexisting-thread"], patched_agent._ToolCallCapHook) == 1


def test_no_double_injection_on_reinsert(patched_agent):
    """Re-inserting the same agent for the same thread_id must NOT add a
    second cap hook (otherwise the effective cap would be halved)."""
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("re")

    d["thread-re"] = a
    d["thread-re"] = a  # re-insert same agent

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1


def test_no_double_injection_on_bulk_reinsert(patched_agent):
    d = patched_agent._HookInjectingAgentDict()
    a = _FakeAgent("bulk")
    d["t"] = a
    d.update({"t": a})
    d.setdefault("t", a)
    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1
