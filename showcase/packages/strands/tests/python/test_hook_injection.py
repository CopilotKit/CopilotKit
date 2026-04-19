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

    def __init__(self, label: str = "", **kwargs):
        self.label = label
        self.hooks = _FakeHookRegistry()
        # Accept (and stash) whatever kwargs the real ``strands.Agent``
        # accepts (``model``, ``system_prompt``, ``tools``, ...). Tests
        # don't inspect these — the point is to let factory code that
        # calls ``Agent(model=..., tools=[...])`` construct this fake
        # without a TypeError.
        self.kwargs = kwargs


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


def test_update_with_dict_items_view(patched_agent):
    """``dict.items()`` is a ``Mapping``-like view, but iterating it yields
    ``(k, v)`` pairs (not keys). The ``update`` override must handle this
    input shape — otherwise ``.items()`` would fall through to the
    pair-iterable branch and work, but we want an explicit assertion.

    Concretely: strands / ag_ui_strands can legitimately pass a
    ``dict_items`` view (e.g. filtering a source dict). Injection must
    still fire for each contained Agent.
    """
    d = patched_agent._HookInjectingAgentDict()
    a, b = _FakeAgent("iv-a"), _FakeAgent("iv-b")
    source = {"thread-iv-a": a, "thread-iv-b": b}

    d.update(source.items())

    assert _count_cap_hooks(a, patched_agent._ToolCallCapHook) == 1
    assert _count_cap_hooks(b, patched_agent._ToolCallCapHook) == 1
    assert d["thread-iv-a"] is a
    assert d["thread-iv-b"] is b


def test_update_with_mapping_subtype(patched_agent):
    """``collections.ChainMap`` is a ``collections.abc.Mapping`` subtype.
    The ``update`` override must correctly route it through the Mapping
    branch so every contained Agent gets a cap hook attached.

    The assertions pin correctness only: every value in the chain lands
    in the injecting dict with exactly one cap hook.
    """
    from collections import ChainMap

    d = patched_agent._HookInjectingAgentDict()
    a1, a2 = _FakeAgent("m-a1"), _FakeAgent("m-a2")
    primary = {"thread-a1": a1}
    fallback = {"thread-a2": a2}
    cm = ChainMap(primary, fallback)

    d.update(cm)

    assert "thread-a1" in d
    assert "thread-a2" in d
    assert d["thread-a1"] is a1
    assert d["thread-a2"] is a2
    assert _count_cap_hooks(a1, patched_agent._ToolCallCapHook) == 1
    assert _count_cap_hooks(a2, patched_agent._ToolCallCapHook) == 1


def test_build_showcase_agent_swaps_hook_dict(monkeypatch, patched_agent):
    """Factory integration: ``build_showcase_agent()`` must replace the
    ``StrandsAgent._agents_by_thread`` dict with ``_HookInjectingAgentDict``,
    preserve any pre-existing entries, and ensure every entry has a cap
    hook attached.

    The conftest stubs out ``StrandsAgent`` / ``StrandsAgentConfig`` /
    ``ToolBehavior`` as permissive classes. We patch ``StrandsAgent`` to
    seed one pre-existing entry in ``_agents_by_thread`` during
    construction, so the factory's copy-and-wrap logic is actually
    exercised.
    """
    import agents.agent as agent_mod

    # Pre-existing Agent (with a FakeAgent stand-in that matches the
    # isinstance check in ``_HookInjectingAgentDict.__setitem__``).
    preexisting_agent = _FakeAgent("pre")

    class _SeededStrandsAgent:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            # Emulate ag_ui_strands seeding the dict in ``__init__``.
            self._agents_by_thread = {"preexisting-thread": preexisting_agent}

    # Patch the ``StrandsAgent`` reference bound in the ``agents.agent``
    # module (not the source in ``ag_ui_strands``). The module already
    # captured the original class at import time — patching the source
    # module would have no effect on the factory's call site.
    monkeypatch.setattr(agent_mod, "StrandsAgent", _SeededStrandsAgent)

    # The factory calls ``_build_model`` which requires OPENAI_API_KEY.
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-for-factory")

    # Ensure Agent isinstance checks inside the dict succeed for our fake.
    # ``patched_agent`` already swapped ``agents.agent.Agent`` → _FakeAgent.

    from agents.agent import (
        _HookInjectingAgentDict,
        _ToolCallCapHook,
        build_showcase_agent,
    )

    agui_agent = build_showcase_agent()

    # 1. The per-thread dict is the hook-injecting variant.
    assert isinstance(agui_agent._agents_by_thread, _HookInjectingAgentDict)

    # 2. Pre-existing entries survived the swap.
    assert "preexisting-thread" in agui_agent._agents_by_thread
    assert agui_agent._agents_by_thread["preexisting-thread"] is preexisting_agent

    # 3. Every surviving entry has a cap hook attached.
    for agent in agui_agent._agents_by_thread.values():
        assert _count_cap_hooks(agent, _ToolCallCapHook) == 1


def test_agent_has_cap_hook_uses_sentinel_not_private_attrs(patched_agent):
    """``_agent_has_cap_hook`` must check a sentinel attribute we own,
    NOT spelunk HookRegistry privates. If an upstream ``HookRegistry``
    rename drops ``_hook_providers`` / ``hook_providers``, double-injection
    would silently return — which halves the effective cap.

    We simulate the rename by constructing a registry WITHOUT those
    attributes but WITH the sentinel, and assert ``_agent_has_cap_hook``
    still returns True.
    """
    from agents.agent import _agent_has_cap_hook, _CAP_HOOK_SENTINEL_ATTR

    class _RegistryWithoutPrivates:
        # Deliberately missing _hook_providers AND hook_providers.
        pass

    agent = _FakeAgent("sentinel")
    agent.hooks = _RegistryWithoutPrivates()
    # Without the sentinel, no cap hook is known.
    assert not _agent_has_cap_hook(agent)

    # With the sentinel, the check must return True regardless of what
    # HookRegistry looks like internally.
    setattr(agent, _CAP_HOOK_SENTINEL_ATTR, True)
    assert _agent_has_cap_hook(agent)
